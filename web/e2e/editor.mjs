// 편집 화면을 헤드리스 크롬으로 직접 조작해 본다.
//   node e2e/editor.mjs [주소]          (서버가 떠 있어야 한다: uv run mditor-server)
// 한글 조합(IME)은 CDP 의 Input.imeSetComposition → Input.insertText 로 흉내 낸다.
// 실제 OS 입력기(Windows/Edge, macOS/Safari)는 사람이 따로 확인한다.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const base = process.argv[2] ?? "http://127.0.0.1:8011";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});

let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed++;
    console.log(`  ✗ ${label} ${detail}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** start: 시작 화면에서 누를 것(new · open · example). null 이면 시작 화면에 그대로 둔다. */
async function openPage(path = "/edit", viewport = { width: 1440, height: 900 }, { start = "example" } = {}) {
  const context = await browser.createBrowserContext(); // 빈 브라우저 저장소
  const page = await context.newPage();
  await page.setViewport(viewport);
  const state = { md: "", errors: [] };
  page.on("dialog", (d) => d.accept()); // beforeunload 때문에 멈추지 않게
  page.on("pageerror", (e) => state.errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && state.errors.push(m.text()));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/md/preview")) state.md = JSON.parse(r.postData()).md;
  });
  await page.goto(base + path, { waitUntil: "networkidle0" });
  const cdp = await page.createCDPSession();
  if (start === null) return { page, cdp, state, context };
  if (!path.includes("#")) {
    await page.waitForSelector(`.start [data-act="${start}"]`);
    await page.click(`.start [data-act="${start}"]`);
  }
  await page.waitForSelector(".ProseMirror", { timeout: 15000 });
  await page.waitForSelector(".paper h2");
  return { page, cdp, state, context };
}

/** 미리보기 요청이 지금 글을 따라올 때까지 기다린다(디바운스 300ms). */
const settle = () => sleep(650);

/** 편집기가 만든 MD 가 서버의 표준 꼴과 바이트 단위로 같은지 — 다르면 첫 다른 줄을 돌려준다. */
async function drift(md) {
  const r = await (await fetch(`${base}/api/md/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ md }) })).json();
  if (!r.ok) return `서버가 읽지 못함: ${JSON.stringify(r.error)}`;
  if (r.md === md) return "";
  const a = md.split("\n");
  const b = r.md.split("\n");
  const i = a.findIndex((line, k) => line !== b[k]);
  return `화면 ${JSON.stringify(a[i])} ≠ 서버 ${JSON.stringify(b[i])}`;
}

/** 글자 needle 의 뒤(또는 앞)에 커서를 둔다. to 를 주면 needle 전체를 고른다. */
const caret = (page, needle, { after = true, select = false } = {}) =>
  page.evaluate(
    (needle, after, select) => {
      const ed = document.querySelector(".ProseMirror").editor;
      let at = -1;
      ed.state.doc.descendants((n, p) => {
        if (at < 0 && n.isText && n.text.includes(needle)) at = p + n.text.indexOf(needle);
      });
      if (at < 0) throw new Error("not found: " + needle);
      ed.commands.focus();
      if (select) ed.commands.setTextSelection({ from: at, to: at + needle.length });
      else ed.commands.setTextSelection(at + (after ? needle.length : 0));
    },
    needle,
    after,
    select,
  );

/** 한글 한 글자를 조합해서 넣는다: ㅎ → 하 → 한 → 확정 */
async function compose(cdp, steps, commit = steps[steps.length - 1]) {
  for (const text of steps) await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await cdp.send("Input.insertText", { text: commit });
}

const clickText = async (page, selector, text) => {
  const handle = await page.evaluateHandle(
    (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim() === text),
    selector,
    text,
  );
  if (!handle.asElement()) throw new Error(`no ${selector} with text ${text}`);
  await handle.asElement().click();
};

/** 글이 text 로 시작하는 것을 누른다(단축키 표시처럼 뒤에 붙는 글이 있을 때). */
const clickPrefix = async (page, selector, text) => {
  const handle = await page.evaluateHandle(
    (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim().startsWith(text)),
    selector,
    text,
  );
  if (!handle.asElement()) throw new Error(`no ${selector} starting with ${text}`);
  await handle.asElement().click();
};

const docName = (page, name) => page.waitForFunction((name) => document.querySelector(".docname")?.value === name, { timeout: 8000 }, name);

/** 파일을 창에 끌어다 놓는다(실제 끌기 대신 drop 이벤트를 보낸다). */
const dropFile = (page, name, text, type) =>
  page.evaluate(
    (name, text, type) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    name,
    text,
    type,
  );

const setMd = (page, value) =>
  page.evaluate((value) => {
    const ta = document.querySelector(".mdedit textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

// ───────────────────────── 1. 문서 편집기 ─────────────────────────
console.log("문서 편집기");
{
  const { page, cdp, state, context } = await openPage();
  await settle();
  const first = state.md;
  ok(first.startsWith("# 2026년 3분기 온라인 서점 운영 보고"), "시작 화면에서 예시를 열면 예시 문서가 열린다");
  const indent = await page.evaluate(() => {
    const li = document.querySelector('.ProseMirror li[data-level="1"]');
    return li ? parseFloat(getComputedStyle(li).marginLeft) : -1;
  });
  ok(indent > 10, "하위 항목이 들여쓰기되어 보인다", `margin-left ${indent}`);

  // 한글 조합 — 항목 끝
  await caret(page, "결제·환불: 1,480건");
  await compose(cdp, ["ㅎ", "하", "한"]);
  await settle();
  ok(state.md.includes("- 결제·환불: 1,480건한\n"), "항목 끝에서 한글 조합");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 받침 이동: "한" + ㅏ → "하나"
  await compose(cdp, ["ㅎ", "하", "한"], "하");
  await compose(cdp, ["나"]);
  await settle();
  ok(state.md.includes("- 결제·환불: 1,480건한하나\n"), "받침 이동(한+ㅏ → 하나)");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 항목 맨 앞
  await caret(page, "도서 정보 오류", { after: false });
  await compose(cdp, ["ㄱ", "가"]);
  await settle();
  ok(state.md.includes("- 가도서 정보 오류: 410건<br>"), "항목 맨 앞에서 한글 조합");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 굵게 끝
  await caret(page, "18억 4천만 원");
  await compose(cdp, ["ㄱ", "구", "굵"]);
  await settle();
  ok(state.md.includes("**18억 4천만 원굵**으로"), "굵은 글자 끝에서 조합하면 굵게가 이어진다", state.md.split("\n")[5]);
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 표 칸
  await caret(page, "문학");
  await compose(cdp, ["ㅅ", "시"]);
  await settle();
  ok(state.md.includes("| 문학시 | 412 | 96 | 27.6% |"), "표 칸에서 한글 조합");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 선택 영역 바꾸기
  await caret(page, "문학시", { select: true });
  await compose(cdp, ["ㅅ", "소"], "소");
  await compose(cdp, ["ㅅ", "서", "설"]);
  await settle();
  ok(state.md.includes("| 소설 | 412 | 96 | 27.6% |"), "고른 글자를 조합 입력으로 바꾼다");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 칸 고르기: 마우스로 끌어 2×2 를 고르고 합친다
  const box = (text) =>
    page.evaluate((text) => {
      const td = [...document.querySelectorAll(".ProseMirror td")].find((el) => el.textContent.trim() === text);
      td.scrollIntoView({ block: "center" });
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
  await box("298"); // 먼저 화면에 들어오게 한 뒤, 끄는 동안에는 스크롤하지 않는다
  const a = await box("365");
  const b = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".ProseMirror td")].find((el) => el.textContent.trim() === "88").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const picked = await page.$$eval(".ProseMirror .selectedCell", (els) => els.map((e) => e.textContent.trim()));
  ok(picked.length === 4, "마우스로 끌어 칸 넷을 고른다", JSON.stringify(picked));
  await clickText(page, ".table-tools .tool", "칸 합치기");
  await settle();
  ok(state.md.includes("| 인문·사회 | 365<br>71<br>298<br>88 | < | 23.7% |\n| 경제·경영 | ^ | ^ | 21.0% |"), "칸 합치기 → MD 의 < 와 ^");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 머리글 칸과 본문 칸이 섞이면 합치지 않는다
  const th = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".ProseMirror th")].find((e) => e.textContent.trim() === "지표");
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const td = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".ProseMirror td")].find((el) => el.textContent.trim() === "첫 응답 시간").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(th.x, th.y);
  await page.mouse.down();
  await page.mouse.move(td.x, td.y, { steps: 6 });
  await page.mouse.up();
  const before = state.md;
  ok((await page.$$eval(".ProseMirror .selectedCell", (els) => els.length)) === 2, "머리글 칸과 본문 칸을 함께 고른다");
  await clickText(page, ".table-tools .tool", "칸 합치기");
  await settle();
  ok(state.md === before, "머리글 칸과 본문 칸이 섞이면 합치기를 거부한다");

  // 열 정렬 · 칸 음영
  await caret(page, "달성");
  await clickText(page, ".table-tools .tool", "오른쪽");
  await clickText(page, ".table-tools .tool", "칸 음영");
  await settle();
  ok(state.md.includes("|:---|:---:|:---:|---:|") && state.md.includes("| {음영}달성{/음영} |"), "열 정렬과 칸 음영");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 붙여넣기: 워드 · 엑셀 HTML — 이 문서의 서식만 남는다
  await caret(page, "전자책 뷰어의 글꼴 설정을 개선한다.");
  await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror").editor;
    ed.view.pasteHTML(
      '<p class="MsoNormal" style="font-size:20pt;font-family:Batang"><span style="color:#ff0000">빨간</span> <b>굵은</b> <i>기울임</i> <span style="color:#00aa00;font-size:30pt">초록</span></p>',
    );
  });
  await settle();
  ok(state.md.includes("{빨강}빨간{/빨강} **굵은** 기울임 초록"), "워드 붙여넣기 — 빨강·굵게만 남고 크기·글꼴·다른 색은 버린다", state.md.split("\n").find((l) => l.includes("빨간")));
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));
  await caret(page, "일정은 10월 운영 회의에서 확정한다.");
  await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror").editor;
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: "paragraph" });
    ed.commands.focus("end");
    ed.view.pasteHTML('<table><tr><td style="background:#ffff00;font-weight:bold">품목</td><td align="right">값</td></tr><tr><td>A</td><td align="right">10</td></tr></table>');
  });
  await settle();
  ok(/\| \*\*품목\*\* \| 값 \|\n\|---\|---:?\|\n\| A \| 10 \|/.test(state.md), "엑셀 표 붙여넣기", state.md.slice(-120));
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 탭 전환: MD 탭에서 고친 것과 문서 탭에서 고친 것이 서로 덮이지 않는다
  const beforeTabs = state.md;
  await clickText(page, ".pane.left .tab", "MD");
  await page.waitForSelector(".mdedit textarea");
  ok((await page.$eval(".mdedit textarea", (el) => el.value)) === beforeTabs, "MD 탭에는 문서 탭에서 고친 글이 그대로 있다");
  await setMd(page, beforeTabs + "\nMD 탭에서 쓴 문단\n");
  await settle();
  await clickText(page, ".pane.left .tab", "문서");
  await page.waitForSelector(".ProseMirror");
  await settle();
  ok(await page.$eval(".ProseMirror", (el) => el.textContent.includes("MD 탭에서 쓴 문단")), "문서 탭으로 돌아오면 MD 탭에서 쓴 글이 보인다");
  await caret(page, "MD 탭에서 쓴 문단");
  await page.keyboard.type("X");
  await settle();
  ok(state.md.includes("MD 탭에서 쓴 문단X") && state.md.includes("| 소설 | 412") && state.md.includes("1,480건한하나"), "다시 고쳐도 앞서 고친 것이 남아 있다");
  ok(!(await drift(state.md)), "  └ 서버 표준 꼴과 같다", await drift(state.md));

  // 미리보기 · 쪽
  ok(await page.$eval(".paper", (el) => el.textContent.includes("MD 탭에서 쓴 문단X")), "화면 미리보기가 따라온다");
  await sleep(1500);
  ok(/전체 \d+쪽/.test(await page.$eval(".pane.right .pane-info", (el) => el.textContent)), "전체 쪽 수가 보인다");

  // PDF 탭
  await clickText(page, ".pane.right .tab", "PDF");
  await page.waitForSelector('.pdfview iframe[src^="blob:"]', { timeout: 15000 });
  ok(true, "PDF 탭에 PDF 가 뜬다");
  await clickText(page, ".pane.right .tab", "미리보기");

  // 저장 → 다시 열기
  await clickText(page, ".top .btn", "저장");
  await page.waitForFunction(() => document.querySelector(".top .state")?.textContent.includes("판본 1 저장됨"), { timeout: 8000 });
  ok(true, "저장하면 판본 1 이 생긴다");
  const saved = state.md;
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  await settle();
  ok(state.md === saved, "다시 열어도 저장한 글 그대로다", `${state.md.length} / ${saved.length} ${await drift(saved)}`);
  ok(!(await page.$(".notice")), "임시저장 알림이 없다", await page.$eval(".notice", (el) => el.textContent).catch(() => ""));

  // 임시저장: 저장하지 않고 닫았다 열면 이어서 쓴다
  await caret(page, "MD 탭에서 쓴 문단X");
  await page.keyboard.type(" 저장 안 한 글");
  await sleep(900);
  ok((await page.$eval(".pane.right .pane-info", (el) => el.textContent)).includes("바뀐 블록 1개"), "저장본에서 바뀐 블록 수가 보인다");
  ok((await page.$$eval(".paper .blk[data-change]", (els) => els.length)) === 1, "바뀐 블록에 표시가 붙는다");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  await settle();
  ok(state.md.includes("저장 안 한 글") && (await page.$eval(".notice", (el) => el.textContent)).includes("이어서 열었습니다"), "저장하지 않은 글을 이어서 연다");
  await clickText(page, ".notice .btn", "저장본으로 되돌리기");
  await settle();
  await settle();
  ok(state.md === saved, "저장본으로 되돌리기");

  ok(state.errors.length === 0, "콘솔 오류 없음", state.errors.join(" | "));
  await context.close();
}

// ───────────────────────── 2. 쪽 경계 · 오류 줄 · 링크 ─────────────────────────
console.log("쪽 경계 · 오류 줄 · 링크");
{
  const { page, state, context } = await openPage();
  await clickText(page, ".pane.left .tab", "MD");
  await page.waitForSelector(".mdedit textarea");
  const parts = ["# 긴 문서"];
  for (let s = 1; s <= 4; s++) {
    parts.push(`## ${s}. 섹션`, `### 목록 ${s}\n` + Array.from({ length: 30 }, (_, i) => `- 항목 ${i + 1}`).join("\n"));
    parts.push(`### 표 ${s}\n| 번호 | 내용 |\n|---|---|\n` + Array.from({ length: 60 }, (_, i) => `| ${i + 1} | 내용 ${i + 1} |`).join("\n"));
  }
  const long = parts.join("\n\n") + "\n";
  await setMd(page, long);
  await sleep(3200);
  const layout = await (await fetch(`${base}/api/md/preview-pages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ md: long }) })).json();
  const marks = await page.$$eval(".paper .pagemark span", (els) => els.map((e) => e.textContent));
  const want = Array.from({ length: layout.layout.total - 1 }, (_, i) => `${i + 2}쪽`);
  ok(JSON.stringify(marks) === JSON.stringify(want), `쪽 경계가 쪽마다 하나씩, 순서대로 그려진다(전체 ${layout.layout.total}쪽)`, `${marks.length} 개: ${marks.slice(0, 6)}`);
  ok((await page.$$eval(".paper tr.pagemark-row", (els) => els.length)) > 0, "표 안에서 행 사이에도 경계가 그려진다");

  // 오류 줄
  await setMd(page, "# 제목\n\n## 가\n\n| a | b |\n| 1 | 2 |\n");
  await page.waitForSelector(".mderror", { timeout: 5000 });
  ok((await page.$eval(".mderror", (el) => el.textContent)).includes("5번째 줄"), "오류가 난 줄 번호를 알려 준다");
  ok((await page.$eval(".gutter .bad", (el) => el.textContent)) === "5", "그 줄이 표시된다");
  await clickText(page, ".pane.left .tab", "문서");
  await page.waitForSelector(".pane.left .hint");
  ok((await page.$eval(".pane.left .hint", (el) => el.textContent)).includes("문서 모드로 열 수 없습니다"), "오류가 있으면 문서 모드 대신 안내가 나온다");

  // MD 탭 도구
  await clickText(page, ".pane.left .hint .btn", "MD 탭에서 고치기");
  await page.waitForSelector(".mdedit textarea");
  await setMd(page, "굵게 할 글\n");
  await page.$eval(".mdedit textarea", (el) => (el.focus(), el.setSelectionRange(0, 5)));
  await page.click('.mdpane .tool[title^="굵게"]');
  await settle();
  ok(state.md === "**굵게 할** 글\n", "MD 탭의 굵게 단추", JSON.stringify(state.md));
  ok(state.errors.length === 0, "콘솔 오류 없음", state.errors.join(" | "));
  await context.close();

  // 문서가 든 링크(서버 core.editor_link 와 같은 꼴)
  const md = "# 링크로 온 문서\n\n## 1. 내용\n\n- 주소의 # 뒤에 실려 온다\n";
  const hash = deflateRawSync(Buffer.from(md, "utf8")).toString("base64url");
  const linked = await openPage(`/edit#md=${hash}`);
  await settle();
  ok(linked.state.md === md && (await linked.page.$eval(".docname", (el) => el.value)) === "링크로 온 문서", "문서가 든 링크를 열면 새 문서로 열린다");
  ok(!(await linked.page.evaluate(() => location.hash)), "연 뒤에는 주소에서 문서를 지운다");
  await linked.context.close();
}

// ───────────────────────── 3. 시작 화면 · 새 문서 · 파일 열기 ─────────────────────────
console.log("시작 화면 · 새 문서 · 파일 열기");
{
  const { page, state, context } = await openPage("/edit", undefined, { start: null });
  await page.waitForSelector(".start");
  ok(!(await page.$(".ProseMirror")), "보관한 문서가 없으면 시작 화면이 뜬다");

  // 예시: 보기만 하면 내 문서에 남지 않는다
  await page.click('.start [data-act="example"]');
  await page.waitForSelector(".ProseMirror");
  ok((await page.$eval(".notice", (el) => el.textContent)).includes("예시 문서입니다"), "예시는 예시라고 알린다");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".start");
  ok(true, "예시는 저장하지 않으면 남지 않는다");

  // 새 문서
  await page.click('.start [data-act="new"]');
  await page.waitForSelector(".ProseMirror");
  await settle();
  ok(state.md.startsWith("# 제목 없는 문서") && !(await page.$(".notice")), "새 문서가 열린다(예시 알림 없음)", JSON.stringify(state.md.slice(0, 30)));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".ProseMirror");
  ok((await page.$eval(".docname", (el) => el.value)) === "제목 없는 문서", "새 문서는 바로 보관된다");

  // 파일 메뉴 → 파일 열기: 파일 이름이 문서 이름이 된다
  const dir = mkdtempSync(join(tmpdir(), "mditor-e2e-"));
  const utf = join(dir, "3분기 보고.md");
  writeFileSync(utf, "# 파일에서 연 문서\r\n\r\n## 1. 내용\r\n\r\n- 디스크에서 읽었다\r\n");
  await clickText(page, ".top .btn", "파일");
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickPrefix(page, ".menu-item", "파일 열기")]);
  await chooser.accept([utf]);
  await docName(page, "3분기 보고");
  await settle();
  ok(state.md === "# 파일에서 연 문서\n\n## 1. 내용\n\n- 디스크에서 읽었다\n", "파일 메뉴로 MD 파일을 연다(이름 = 파일 이름, CRLF → LF)", JSON.stringify(state.md));

  // Ctrl+O · EUC-KR 파일
  const euc = join(dir, "옛 문서.md");
  writeFileSync(euc, Buffer.concat([Buffer.from("# "), Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9]), Buffer.from("\n\n## 1. A\n\n- B\n")]));
  const [chooser2] = await Promise.all([
    page.waitForFileChooser(),
    (async () => {
      await page.keyboard.down("Control");
      await page.keyboard.press("o");
      await page.keyboard.up("Control");
    })(),
  ]);
  await chooser2.accept([euc]);
  await docName(page, "옛 문서");
  await settle();
  ok(state.md.startsWith("# 가나다\n"), "Ctrl+O 로 열고, EUC-KR 파일도 한글로 읽는다", JSON.stringify(state.md.slice(0, 20)));

  // 끌어다 놓기
  await dropFile(page, "놓은 파일.md", "# 끌어다 놓은 문서\n\n## 1. 내용\n\n- 놓았다\n", "text/markdown");
  await docName(page, "놓은 파일");
  ok(true, "MD 파일을 끌어다 놓으면 새 문서로 열린다");
  await dropFile(page, "그림.png", "png", "image/png");
  await page.waitForSelector(".toast.bad");
  ok((await page.$eval(".toast.bad", (el) => el.textContent)).includes("MD 파일(.md)만"), "MD 가 아닌 파일은 열지 않고 알린다");
  ok((await page.$eval(".docname", (el) => el.value)) === "놓은 파일", "그때 열린 문서는 그대로다");

  // 내 문서: 예시는 들지 않는다. 모두 지우면 시작 화면으로
  await clickText(page, ".top .btn", "파일");
  await clickText(page, ".menu-item", "내 문서");
  await page.waitForSelector(".rows li");
  const names = await page.$$eval(".rows .name", (els) => els.map((el) => el.textContent));
  ok(names.length === 4 && !names.some((n) => n.includes("온라인 서점")), "내 문서에는 연 문서만 있고 예시는 없다", JSON.stringify(names));
  for (let n = names.length; n > 0; n--) {
    await page.click(".rows li .btn.danger");
    await page.waitForFunction((n) => document.querySelectorAll(".rows li").length === n - 1 || document.querySelector(".start"), {}, n);
  }
  await page.waitForSelector(".start");
  ok(true, "문서를 모두 지우면 시작 화면으로 돌아간다");

  rmSync(dir, { recursive: true, force: true });
  ok(state.errors.length === 0, "콘솔 오류 없음", state.errors.join(" | "));
  await context.close();
}

// ───────────────────────── 4. 좁은 화면 ─────────────────────────
console.log("좁은 화면");
{
  const { page, state, context } = await openPage("/edit", { width: 390, height: 780 });
  const overflow = await page.evaluate(() => {
    const top = document.querySelector(".top").getBoundingClientRect();
    const save = [...document.querySelectorAll(".top .btn")].map((b) => b.getBoundingClientRect().right);
    return { top: top.right, right: Math.max(...save), width: innerWidth };
  });
  ok(overflow.top <= overflow.width + 1 && overflow.right <= overflow.width + 1, "머리 줄이 화면 안에 들어온다", JSON.stringify(overflow));
  await clickText(page, ".mobile-switch .tab", "미리보기");
  ok(await page.$eval(".pane.right", (el) => getComputedStyle(el).display !== "none"), "미리보기로 전환된다");
  ok(state.errors.length === 0, "콘솔 오류 없음", state.errors.join(" | "));
  await context.close();
}

// ───────────────────────── 5. 영어 화면 · 영어 태그 ─────────────────────────
console.log("영어 화면 · 영어 태그");
{
  const { page, state, context } = await openPage("/en/edit");
  await settle();
  await settle();
  ok(state.md.startsWith("# Online Bookstore") && state.md.includes("{red}") && !state.md.includes("{빨강}"), "영어 화면의 예시는 영어 태그로 쓴 영어 문서다", JSON.stringify(state.md.slice(0, 40)));
  const labels = await page.$$eval(".pane .tab", (els) => els.map((el) => el.textContent));
  ok(JSON.stringify(labels) === JSON.stringify(["Document", "MD", "Preview", "PDF"]), "탭 이름이 영어다", JSON.stringify(labels));
  ok((await page.$eval(".paper .pagemark", (el) => el.textContent.trim())) === "Page 2", "쪽 경계 표시가 영어다");
  ok((await page.$eval(".top .state", (el) => el.textContent)) === "Not saved yet", "문서 탭으로 열기만 해서는 바뀌지 않는다(태그 언어가 서버와 같다)", await page.$eval(".top .state", (el) => el.textContent));

  // 문서 탭에서 고쳐도 영어 태그 그대로
  await caret(page, "rose 9% on the previous quarter");
  await page.keyboard.type(" (sharply)");
  await settle();
  ok(state.md.includes("{red}rose 9% on the previous quarter (sharply){/red}") && !state.md.includes("{빨강}"), "문서 탭에서 고친 글도 영어 태그로 쓴다", await drift(state.md));

  // MD 탭: 태그가 없는 문서에서 서식 단추는 화면 언어(영어)의 태그를 쓴다 · 서버 오류 문구도 영어
  await clickText(page, ".pane.left .tab", "MD");
  await page.waitForSelector(".mdedit textarea");
  await setMd(page, "# T\n\n- word\n");
  await page.evaluate(() => {
    const ta = document.querySelector(".mdedit textarea");
    ta.focus();
    ta.setSelectionRange(ta.value.indexOf("word"), ta.value.indexOf("word") + 4);
  });
  await page.click('.mdpane .tool[title="Underline (Ctrl+U)"]');
  await settle();
  ok(state.md === "# T\n\n- {underline}word{/underline}\n", "태그가 없으면 화면 언어의 태그로 넣는다", JSON.stringify(state.md));
  await setMd(page, "# T\n\n| a |\n| 1 |\n");
  await page.waitForSelector(".mderror");
  ok((await page.$eval(".mderror", (el) => el.textContent)).includes("The table has no separator row"), "서버 오류 문구가 영어다", await page.$eval(".mderror", (el) => el.textContent));
  ok(state.errors.length === 0, "콘솔 오류 없음", state.errors.join(" | "));
  await context.close();

  // 한국어 화면에서 영어 태그 문서를 고쳐도 영어 태그 그대로(문서의 태그 언어를 따른다)
  const md = "# 링크 문서\n\n## 1. 내용\n\n- {red}빨강{/red} 글\n";
  const hash = deflateRawSync(Buffer.from(md, "utf8")).toString("base64url");
  const ko = await openPage(`/edit#md=${hash}`);
  await caret(ko.page, "글");
  await ko.page.keyboard.type("자");
  await settle();
  ok(ko.state.md === "# 링크 문서\n\n## 1. 내용\n\n- {red}빨강{/red} 글자\n", "한국어 화면에서도 영어 태그 문서는 영어 태그로 쓴다", JSON.stringify(ko.state.md));
  await ko.context.close();
}

await browser.close();
console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과");
process.exit(failed ? 1 : 0);
