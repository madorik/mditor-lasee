// 쿠팡 파트너스 다이나믹 배너를 한국어 정적 쪽(첫 화면 · 문법 · 개발자)에 낸다. 편집기(/edit)와 영어 쪽에는 내지 않는다.
// 모두 쪽 안에 가만히 있는 배너다 — 화면을 덮는 팝업이나 스크롤을 따라다니는 배너는 쿠팡 파트너스가 금지해서 쓰지 않는다.
// 자리와 코드는 lib/banners.ts — 코드가 없는 자리는 아무것도 그리지 않는다(주소에 ?ads=demo 를 붙이면 자리만 보여 준다).
//
// 쿠팡 코드는 쪽에 직접 심는다(lib/coupangMount.ts): 우리 틀(iframe)이나 sandbox 안에 넣으면 쿠팡 위젯이 내용을 줄여서 그린다(사진 29장 → 1장).
import { liveBanners, SIZES, type BannerSlot } from "./lib/banners";
import { mountBanner } from "./lib/coupangMount";
import { DISCLOSURE } from "./lib/picks";
import "./styles/banners.css";

const demo = new URLSearchParams(location.search).get("ads") === "demo";
const PAGES = new Set(["", "syntax", "developers"]);
const pageKey = () => location.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "").replace(/^index$/, "");

interface Slot {
  el: HTMLElement;
  width: number;
  height: number;
  /** 자리가 쪽에 붙은 다음에 부른다(쿠팡 코드는 쪽에 붙은 뒤에야 돈다) */
  run?: () => void;
}

/** 그 자리의 배너(없으면 null, 데모면 자리만) */
function node(slot: BannerSlot): Slot | null {
  const live = liveBanners(slot)[0];
  const box = document.createElement("div");
  if (live) {
    box.className = "adframe adbox";
    box.style.width = `${live.width}px`;
    box.style.height = `${live.height}px`;
    return { el: box, width: live.width, height: live.height, run: () => mountBanner(box, live.html) };
  }
  if (!demo) return null;
  const [width, height] = SIZES[slot];
  box.className = "adframe demo";
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.textContent = `광고 자리 ${width}×${height}`;
  return { el: box, width, height };
}

/** 쪽 안의 가로 배너 — 폭이 모자라면 줄여서 맞춘다 */
function inline(slot: "middle" | "bottom", anchor: Element | null, where: "before" | "after"): void {
  const body = node(slot);
  if (!anchor || !body) return;
  const section = document.createElement("section");
  section.className = `picks adinline adinline-${slot}`;
  section.setAttribute("aria-label", "광고 — 쿠팡 파트너스");
  section.innerHTML = '<div class="picks-head"><h2>쿠팡 추천 상품</h2><span class="picks-tag">광고</span></div><div class="adfit"></div>' + `<p class="picks-note">${DISCLOSURE}</p>`;
  const wrap = section.querySelector<HTMLElement>(".adfit")!;
  body.el.style.transformOrigin = "top left";
  wrap.append(body.el);
  const fit = () => {
    const s = Math.min(1, wrap.clientWidth / body.width);
    body.el.style.transform = s < 1 ? `scale(${s})` : "";
    wrap.style.height = `${Math.round(body.height * s)}px`;
  };
  anchor[where](section);
  body.run?.();
  new ResizeObserver(fit).observe(wrap);
  fit();
}

/** 큰 화면에서만, 본문 오른쪽 옆. 쪽과 같이 올라가고 따라다니지 않는다 */
function side(): void {
  const mq = window.matchMedia("(min-width: 1500px)");
  let made = false;
  const make = () => {
    if (made || !mq.matches) return;
    const body = node("side");
    if (!body) return;
    made = true;
    const aside = document.createElement("aside");
    aside.className = "adside";
    aside.setAttribute("aria-label", "광고 — 쿠팡 파트너스");
    aside.innerHTML = '<span class="ad-tag">광고</span>';
    aside.append(body.el);
    aside.insertAdjacentHTML("beforeend", `<p class="ad-note">${DISCLOSURE}</p>`);
    document.body.append(aside);
    body.run?.();
  };
  make();
  mq.addEventListener("change", make); // 창을 넓히면 그때 불러온다(좁을 때는 만들지도 않는다)
}

function start(): void {
  if (document.documentElement.lang !== "ko" || !PAGES.has(pageKey())) return;
  inline("middle", pageKey() === "" ? document.querySelector("section.hero") : null, "after");
  inline("bottom", document.querySelector(".ad-slot"), "before");
  side();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
