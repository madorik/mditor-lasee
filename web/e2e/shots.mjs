// 화면 찍기 — node e2e/shots.mjs <주소> <저장할 폴더>
import puppeteer from "puppeteer-core";

const [base = "http://127.0.0.1:8011", out = "."] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none"],
});
const shot = async (path, name, { width = 1440, height = 900, full = false, wait = 1200, before } = {}) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: "networkidle0" });
  if (before) await before(page);
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log(name, errors.length ? `ERRORS: ${errors.join(" | ")}` : "ok");
  await page.close();
};
await shot("/", "landing", { full: true });
await shot("/edit", "edit", { wait: 3500 });
await shot("/edit", "edit-mobile", { width: 390, height: 780, wait: 3500 });
await shot("/syntax", "syntax", { full: true });
await shot("/developers", "developers", { full: true });
await browser.close();
