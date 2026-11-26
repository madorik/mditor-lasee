// 쿠팡 파트너스 배너 코드를 상자(box) 안에서 돌리는 공용 함수 — 첫 화면의 배너(../banners.ts)와 편집기의 내보내기 화면(../editor/ExportAd.tsx)이 같이 쓴다.
// 쿠팡 코드는 우리 iframe · sandbox 안에 넣으면 내용을 줄여서 그리므로 쪽에 직접 심는다(자세한 사정은 lib/banners.ts).
// 상자는 쪽에 붙어 있어야 한다(안 붙은 상자 안의 스크립트는 돌지 않는다).
//
// 빨리 뜨게:
// - 쿠팡 코드(new PartnersCoupang.G({...}))에 container 로 우리 상자를 넣는다 — 배너(<ins>)가 처음부터 상자 안에 생긴다.
//   안 넣으면 쿠팡은 '문서의 마지막 <script> 앞'에 붙여서 어디에 생길지 모른다(예전엔 그걸 찾느라 배너마다 3초씩 기다렸다).
// - G 는 부르는 자리에서 바로 배너를 만든다(g.js 가 위젯 본문이다). 그래서 배너끼리 기다리지 않고 한꺼번에 띄운다.
// - g.js 는 한 번만 불러온다(배너마다 다시 부르지 않는다). 한국어 쪽 머리에서 미리 받아 둔다(index · syntax · developers .html).

let seq = 0;
/** 불러온 외부 스크립트(주소 → 다 불렀는지). 실패하면 지워서 다음 배너가 다시 부르게 한다 */
const loaded = new Map<string, Promise<boolean>>();

function load(old: HTMLScriptElement): Promise<boolean> {
  const src = old.getAttribute("src")!;
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<boolean>((done) => {
      const s = document.createElement("script");
      for (const name of old.getAttributeNames()) s.setAttribute(name, old.getAttribute(name) ?? "");
      s.onload = () => done(true);
      s.onerror = () => (loaded.delete(src), done(false));
      document.head.append(s);
    });
    loaded.set(src, p);
  }
  return p;
}

/** 쿠팡 코드에 container(상자)를 넣는다. G 를 부르지 않는 코드는 그대로 */
export function withContainer(html: string, selector: string): string {
  return html.replace(/new\s+PartnersCoupang\.G\(\s*\{/, (m) => `${m}"container":${JSON.stringify(selector)},`);
}

async function run(box: HTMLElement, html: string): Promise<void> {
  if (!box.id) box.id = `cpad-${++seq}`;
  const tpl = document.createElement("template");
  tpl.innerHTML = withContainer(html, `#${box.id}`); // 스크립트는 아직 돌지 않는다
  for (const old of Array.from(tpl.content.querySelectorAll("script"))) {
    if (old.getAttribute("src")) {
      await load(old);
      continue;
    }
    if (!box.isConnected) return; // 그새 상자가 없어졌다(내보내기 창을 닫음)
    const s = document.createElement("script");
    for (const name of old.getAttributeNames()) s.setAttribute(name, old.getAttribute(name) ?? "");
    s.text = old.text;
    const before = new Set(Array.from(document.getElementsByTagName("ins")));
    box.append(s); // 여기서 쿠팡 코드가 돈다(배너도 이때 만들어진다)
    // container 를 못 넣은 코드라 배너가 다른 곳에 생겼으면 상자로 옮긴다
    for (const ins of Array.from(document.getElementsByTagName("ins"))) if (!before.has(ins) && !box.contains(ins)) box.append(ins);
  }
}

/** 쿠팡 코드(스크립트 두 줄)를 box 안에서 돌린다 */
export function mountBanner(box: HTMLElement, html: string): void {
  void run(box, html).catch(() => {});
}
