// 첫 화면(index.html) 머리의 영상을 만든다 — 실제 편집기를 헤드리스 크롬으로 조작하며 찍는다.
//   node e2e/hero-video.mjs [주소] [언어 ko|en] [저장할 폴더]      (서버가 떠 있어야 한다: uv run mditor-server)
// 만드는 것: hero-<언어>.mp4(H.264) · hero-<언어>.webp(첫 장면, 포스터). ffmpeg · cwebp 가 있어야 한다.
//
// 장면: 예시 문서의 첫 목록 끝에 항목을 쳐 넣는다 → 오른쪽 미리보기의 쪽 경계(파란 점선)가 앞 블록 앞으로 옮겨진다
// → PDF 탭에서 같은 자리에서 쪽이 넘어가는 것을 보여 준다 → 미리보기로 돌아온다.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const [base = "http://127.0.0.1:8000", lang = "ko", out = "src/assets/hero"] = process.argv.slice(2);
const W = 1280;
const H = 720;
const SCALE = 1.5; // 1920×1080 으로 찍는다
const ITEMS = {
  ko: ["4분기에는 물류 센터를 한 곳 더 연다.", "전자책 할인 행사를 11월에 연다.", "고객 응대 인원을 두 명 늘린다.", "반품 사유를 주문 화면에서 고르게 한다.", "도서 정보 오류를 매주 점검한다."],
  en: ["Open one more fulfillment center in Q4.", "Run an e-book sale in November.", "Add two people to customer support.", "Let customers pick a return reason at checkout.", "Review book metadata errors every week."],
}[lang];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
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

// 찍을 때만: 예시 알림 띠를 숨기고, 마우스 포인터를 그린다(헤드리스 화면에는 포인터가 없다)
await page.addStyleTag({
  content: `
    .notice { display: none !important; }
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; transition: transform 0.7s cubic-bezier(.3,.7,.2,1); }
    #demo-cursor svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    .demo-click { position: fixed; z-index: 99998; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      background: rgba(19,135,201,.35); pointer-events: none; animation: demo-click .5s ease-out forwards; }
    @keyframes demo-click { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
  `,
});
await page.evaluate((w, h) => {
  const c = document.createElement("div");
  c.id = "demo-cursor";
  c.innerHTML =
    '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17.5 15.2 Z" fill="#fff" stroke="#1b2430" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.transform = `translate(${w * 0.55}px, ${h * 0.6}px)`;
  document.body.append(c);
}, W, H);

let at = { x: W * 0.55, y: H * 0.6 };
/** 포인터를 (x, y) 로 옮긴다 — 그린 포인터와 실제 마우스를 같이. */
async function moveTo(x, y) {
  await page.evaluate((x, y) => (document.getElementById("demo-cursor").style.transform = `translate(${x}px, ${y}px)`), x, y);
  await page.mouse.move(x, y, { steps: 12 });
  at = { x, y };
  await sleep(750);
}
async function click() {
  await page.evaluate(({ x, y }) => {
    const r = document.createElement("div");
    r.className = "demo-click";
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    setTimeout(() => r.remove(), 600);
  }, at);
  await page.mouse.click(at.x, at.y);
}
const center = (selector, index = 0) =>
  page.$$eval(selector, (els, i) => {
    const r = els[i].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, index);

/** 쪽 경계 바로 뒤 블록의 글자(경계가 옮겨졌는지 본다) */
const boundary = () =>
  page.evaluate(() => {
    const m = document.querySelector(".paper .pagemark");
    return m ? (m.nextElementSibling ?? m.parentElement).textContent.slice(0, 40) : "";
  });

// 처음 모습: 왼쪽은 문서 맨 위, 오른쪽은 쪽 경계가 아래쪽 2/3 쯤
await page.evaluate(() => {
  document.querySelector(".rich-scroll").scrollTop = 0;
  const desk = document.querySelector(".desk");
  const m = document.querySelector(".paper .pagemark");
  desk.scrollTop += m.getBoundingClientRect().top - desk.getBoundingClientRect().top - desk.clientHeight * 0.68;
});
await sleep(800);

// 찍기: CDP 화면 녹화를 직접 받는다(page.screencast 는 기기 배율을 무시해 1280×720 로 찍힌다).
// 장면은 바뀔 때만 오므로 받은 때(timestamp)를 적어 두었다가 그 길이대로 이어 붙인다.
const work = mkdtempSync(join(tmpdir(), "mditor-hero-"));
const cdp = await page.createCDPSession();
const frames = []; // [파일, 받은 때(초)]
let latest = ""; // 마지막으로 받은 장면(휠이 먹었는지 볼 때 쓴다)
cdp.on("Page.screencastFrame", (e) => {
  const file = join(work, `f${String(frames.length).padStart(5, "0")}.jpg`);
  writeFileSync(file, Buffer.from(e.data, "base64"));
  frames.push([file, e.metadata.timestamp]);
  latest = e.data;
  cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
await sleep(1400);

// 1) 첫 목록의 마지막 항목 끝을 누르고 항목을 쳐 넣는다 — 경계가 옮겨질 때까지
const end = await page.evaluate(() => {
  const ed = document.querySelector(".ProseMirror").editor;
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === "mdList") {
      const last = n.lastChild;
      let off = 0;
      n.forEach((child, o) => (child === last ? (off = o) : null));
      pos = p + 1 + off + last.nodeSize - 1;
      return false;
    }
    return pos < 0;
  });
  const c = ed.view.coordsAtPos(pos);
  return { x: c.left + 2, y: (c.top + c.bottom) / 2 };
});
await moveTo(end.x, end.y);
await click();
await sleep(350);
await moveTo(end.x + 150, end.y + 70); // 포인터가 글을 가리지 않게 비켜 둔다
const before = await boundary();
let typed = 0;
for (const item of ITEMS) {
  await page.keyboard.press("Enter");
  await sleep(250);
  await page.keyboard.type(item, { delay: 55 });
  typed++;
  await sleep(1900); // 미리보기 300ms · 쪽 배치 1.2s 뒤에 바뀐다
  if (typed >= 2 && (await boundary()) !== before) break;
}
const after = await boundary();
await sleep(1600);

// 2) PDF 탭 — 같은 자리에서 쪽이 넘어간다. 브라우저 PDF 보기의 쪽 그림 목록(☰)을 닫고 경계까지 내린다.
const pdfTab = await center(".pane.right .tab", 1);
await moveTo(pdfTab.x, pdfTab.y);
await click();
await page.waitForSelector('.pdfview iframe[src^="blob:"]');
await sleep(2000);
const frame = await page.$eval(".pdfview iframe", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await moveTo(frame.x + 32, frame.y + 28);
await click();
await sleep(2000);
await moveTo(frame.x + frame.w * 0.55, frame.y + frame.h * 0.62);
// PDF 보기가 다시 그리는 중이면 휠을 놓친다 — 칸 모습이 바뀌었는지 보고, 그대로면 다시 굴린다
// 찍는 중에 page.screenshot 을 부르면 그 장면(잘라 찍은 것)이 녹화에도 섞인다 — 받고 있는 장면끼리 견준다
const look = async () => latest;
let scrolled = false;
for (let attempt = 0; attempt < 5 && !scrolled; attempt++) {
  const was = await look();
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel({ deltaY: Number(process.env.PDF_SCROLL ?? 480) / 8 });
    await sleep(80);
  }
  await sleep(700);
  scrolled = (await look()) !== was;
  if (!scrolled) await sleep(800);
}
if (!scrolled) console.warn("PDF 보기가 내려가지 않았다");
await sleep(3400);
await cdp.send("Page.stopScreencast");
const stopped = frames.length ? frames[frames.length - 1][1] + 0.05 : 0;
await browser.close();

console.log(`typed ${typed}, boundary: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
if (before === after) console.warn("경계가 옮겨지지 않았다 — 항목을 더 넣어야 한다");

// 받은 장면을 받은 때대로 이어 붙여(30fps) 줄여 담는다: H.264(mp4 — VP9 보다 작았다) · 첫 장면 포스터
const list = frames.map(([file, t], i) => `file '${file}'\nduration ${((frames[i + 1]?.[1] ?? Math.max(stopped, t + 1)) - t).toFixed(4)}`);
writeFileSync(join(work, "list.txt"), [...list, `file '${frames[frames.length - 1][0]}'`].join("\n") + "\n");
const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const input = ["-f", "concat", "-safe", "0", "-i", join(work, "list.txt")];
const vf = `fps=30,scale=${W * SCALE}:${H * SCALE}:flags=lanczos,format=yuv420p`;

ff(...input, "-vf", vf, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", "-an", join(out, `hero-${lang}.mp4`));
execFileSync("cwebp", ["-quiet", "-q", "82", frames[0][0], "-o", join(out, `hero-${lang}.webp`)]);
console.log(`${frames.length} frames, ${(stopped - frames[0][1]).toFixed(1)}s`);
rmSync(work, { recursive: true, force: true });
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
