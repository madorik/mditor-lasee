// 첫 화면(index.html)의 ‘고치는 두 가지 방법, 확인하는 두 가지 방법’ 그림을 만든다.
//   node e2e/landing-images.mjs [주소] [언어 ko|en] [저장할 폴더]      (서버가 떠 있어야 한다: uv run mditor-server)
// 예시 문서의 같은 자리(1쪽 마지막 블록 → 쪽 경계 → 2쪽 첫머리)를 네 가지로 찍어 <폴더>/<언어>/ 에 둔다.
// 편집 화면이 바뀌면 두 언어 모두 다시 돌려서 그림을 새로 만든다.
import puppeteer from "puppeteer-core";

const [base = "http://127.0.0.1:8000", lang = "ko", root = "src/assets/landing"] = process.argv.slice(2);
const out = `${root}/${lang}`;
const W = 1200; // 창 너비 — 칸 하나가 600px
const H = 860;
const CROP = 520; // 칸 위에서부터 찍을 높이
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 헤드리스 크롬은 PDF 보기를 화면을 찍을 때만 다시 그린다 — 몇 번 찍으며 기다린다. */
const pump = async (page, times) => {
  for (let i = 0; i < times; i++) {
    await page.screenshot({ type: "jpeg", quality: 10, captureBeyondViewport: false });
    await sleep(700);
  }
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}${lang === "en" ? "/en" : ""}/edit`, { waitUntil: "networkidle0" });
// 처음 열린 새 문서에서 파일 메뉴 → 예시 문서 보기
await page.waitForSelector(".ProseMirror");
const clickText = (sel, text) => page.evaluate((sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === text).click(), sel, text);
await clickText(".top .btn", lang === "en" ? "File" : "파일");
await page.waitForSelector(".menu-item");
await clickText(".menu-item", lang === "en" ? "View example" : "예시 문서 보기");
await page.waitForSelector(".notice");
await page.waitForSelector(".paper .pagemark");
// 예시 알림 띠는 그림에 넣지 않는다
await page.addStyleTag({ content: ".notice { display: none !important; }" });
await sleep(800);

/** 탭은 자리로 고른다(이름은 언어마다 다르다): 왼쪽 0 문서 · 1 MD, 오른쪽 0 미리보기 · 1 PDF */
const tab = async (pane, index) => (await page.$$(`.pane.${pane} .tab`))[index].click();

// 쪽 경계 바로 앞 블록의 제목 — 네 그림이 모두 이 블록부터 보여 준다
const anchor = await page.evaluate(() => {
  const mark = document.querySelector(".paper .pagemark");
  const heads = [...document.querySelectorAll(".paper h3")].filter((h) => h.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING);
  return heads[heads.length - 1].textContent.trim();
});

const shoot = async (pane, name) => {
  const box = await page.$eval(`.pane.${pane}`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width };
  });
  // captureBeyondViewport 를 끄지 않으면 찍는 동안 창 크기가 바뀌어 미리보기 스크롤이 맨 위로 돌아간다
  await page.screenshot({ path: `${out}/${name}.webp`, type: "webp", quality: 82, clip: { ...box, height: CROP }, captureBeyondViewport: false });
  console.log(lang, name, "ok");
};

/** 칸(pane) 안에서 글이 needle 인 제목(needle 이 없으면 쪽 경계)을, 그것을 감싼 스크롤 상자의 위에서 offset 만큼 아래에 오게 한다. */
const scrollTo = (pane, needle, offset) =>
  page.evaluate(
    (pane, needle, offset) => {
      const target = needle
        ? [...document.querySelectorAll(`.pane.${pane} :is(h1, h2, h3)`)].find((el) => el.textContent.trim() === needle)
        : document.querySelector(`.pane.${pane} .pagemark`);
      let box = target.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - offset;
    },
    pane,
    needle,
    offset,
  );

// 1) 문서 탭 — 보이는 모양 그대로
await scrollTo("left", anchor, 18);
await sleep(300);
await shoot("left", "edit-doc");

// 2) 미리보기 탭 — 쪽 경계(파란 점선)가 가운데쯤. MD 탭으로 바꾸기 전에 찍는다(바꾸면 미리보기가 맨 위로 간다)
await scrollTo("right", null, 250);
await sleep(300);
await shoot("right", "view-preview");

// 3) MD 탭 — 같은 자리의 Markdown
await tab("left", 1);
await page.waitForSelector(".mdedit textarea");
await page.evaluate((anchor) => {
  const ta = document.querySelector(".mdedit textarea");
  const lines = ta.value.split("\n");
  const at = lines.findIndex((l) => l === `### ${anchor}`);
  const css = getComputedStyle(ta);
  ta.scrollTop = Math.max(0, at - 1) * parseFloat(css.lineHeight) + parseFloat(css.paddingTop); // 줄이 잘리지 않게
  ta.dispatchEvent(new Event("scroll"));
}, anchor);
await sleep(300);
await shoot("left", "edit-md");

// 4) PDF 탭 — 브라우저의 PDF 보기. 1쪽 끝과 2쪽 첫머리가 보이게 내린다
await tab("right", 1);
await page.waitForSelector('.pdfview iframe[src^="blob:"]');
await pump(page, 5);
const frame = await page.$eval(".pdfview iframe", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
// 쪽 그림 목록(왼쪽 사이드바)을 닫는다 — PDF 보기 도구 막대 맨 왼쪽 단추
await page.mouse.click(frame.x + 32, frame.y + 28);
await pump(page, 6); // 넓어진 쪽을 다시 그릴 때까지
await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
await page.mouse.wheel({ deltaY: Number(process.env.PDF_SCROLL ?? 620) });
await pump(page, 8); // 쪽을 선명하게 다시 그릴 때까지
await shoot("right", "view-pdf");

await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
