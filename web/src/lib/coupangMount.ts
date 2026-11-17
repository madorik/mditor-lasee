// 쿠팡 파트너스 배너 코드를 상자(box) 안에서 돌리는 공용 함수 — 첫 화면의 배너(../banners.ts)와 편집기의 내보내기 화면(../editor/ExportAd.tsx)이 같이 쓴다.
// 쿠팡 코드는 우리 iframe · sandbox 안에 넣으면 내용을 줄여서 그리므로 쪽에 직접 심는다(자세한 사정은 lib/banners.ts).
// 쿠팡 g.js 는 만든 배너(<ins>)를 body 끝에 붙이므로, 만들어지면 상자 안으로 옮긴다.
// 상자는 쪽에 붙어 있어야 한다(안 붙은 상자 안의 스크립트는 돌지 않는다).

// 한 번에 하나씩 돌린다 — 쿠팡 코드가 만든 배너가 어느 상자 것인지 가리려고
let queue: Promise<void> = Promise.resolve();

async function run(box: HTMLElement, html: string): Promise<void> {
  const tpl = document.createElement("template");
  tpl.innerHTML = html; // 스크립트는 아직 돌지 않는다
  for (const old of Array.from(tpl.content.querySelectorAll("script"))) {
    const s = document.createElement("script");
    for (const name of old.getAttributeNames()) s.setAttribute(name, old.getAttribute(name) ?? "");
    s.text = old.text;
    if (old.getAttribute("src")) {
      await new Promise<void>((done) => {
        s.onload = s.onerror = () => done();
        box.append(s);
      });
      continue;
    }
    const before = new Set(document.body.querySelectorAll(":scope > ins"));
    await new Promise<void>((done) => {
      const grab = () => {
        const ins = Array.from(document.body.querySelectorAll(":scope > ins")).find((e) => !before.has(e));
        if (!ins) return false;
        box.append(ins);
        return true;
      };
      const mo = new MutationObserver(() => grab() && (mo.disconnect(), done()));
      mo.observe(document.body, { childList: true });
      box.append(s); // 여기서 쿠팡 코드가 돈다
      if (grab()) (mo.disconnect(), done());
      window.setTimeout(() => (mo.disconnect(), done()), 3000);
    });
  }
}

/** 쿠팡 코드(스크립트 두 줄)를 box 안에서 돌린다 */
export function mountBanner(box: HTMLElement, html: string): void {
  queue = queue.then(
    () => run(box, html),
    () => run(box, html),
  );
}
