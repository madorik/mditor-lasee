// 맹고 소개 팝업 — 한국어 쪽(첫 화면·편집기·문법·개발자)에 들어오면 한 번 띄운다.
// '닫기'(Esc·바깥 누르기 포함)는 이번 방문 동안, '1주일간 보지 않기'는 7일 동안 다시 띄우지 않는다.
// 자동화 브라우저(e2e·첫 화면 영상·그림 찍기)에는 띄우지 않는다. 주소에 ?promo=show 를 붙이면 언제든 보인다.
// 바깥 스크립트를 들이지 않는 자체 광고라, 편집기에 띄워도 문서가 밖으로 나가지 않는다.
import iconUrl from "./assets/promo/maengo.svg";
// 앱 받기 QR — https://watalabs.com/maengo/go/app?from=lasee-qr (segno 로 만든 그림. 주소를 바꾸면 다시 만든다)
import qrUrl from "./assets/promo/maengo-qr.svg";
import "./styles/promo.css";

const ID = "maengo-1"; // 내용을 크게 바꿔 다시 보여 주고 싶으면 이름을 바꾼다
const HIDE_KEY = `lasee.promo.${ID}.hideUntil`;
const CLOSED_KEY = `lasee.promo.${ID}.closed`;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const PAGES = new Set(["", "edit", "syntax", "developers"]);

// 맹고 쪽 주소. go/app 은 기기를 보고 App Store·Google Play(PC 는 QR 이 있는 앱 받기)로 보내고 from 을 기록한다.
const APP_URL = "https://watalabs.com/maengo/go/app?from=lasee";
const INTRO_URL = "https://watalabs.com/maengo?utm_source=lasee&utm_medium=popup&utm_campaign=house";

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    /* 사생활 보호 창 등 — 이번 화면에서만 닫힌다 */
  }
}

function pageKey(): string {
  return location.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "").replace(/^index$/, "");
}

function shouldShow(): boolean {
  if (new URLSearchParams(location.search).get("promo") === "show") return true;
  if (document.documentElement.lang !== "ko" || !PAGES.has(pageKey())) return false;
  if (navigator.webdriver) return false;
  if (read(() => sessionStorage, CLOSED_KEY)) return false;
  const until = Number(read(() => localStorage, HIDE_KEY));
  return !(until > Date.now());
}

const ICONS = {
  // 줄 그림 아이콘(24×24, 선 2px)
  summary: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m17 15 2 2 3-4"/>',
  listen: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (name: keyof typeof ICONS, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function build(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "promo";
  dialog.setAttribute("aria-labelledby", "promo-title");
  // 막대 높이(소리 파형 그림)
  const wave = [6, 12, 18, 10, 22, 14, 8, 16, 24, 12, 6, 18, 10, 20, 8, 14, 22, 10, 16, 6]
    .map((h, i) => `<i style="height:${h}px"${i < 9 ? ' class="on"' : ""}></i>`)
    .join("");
  dialog.innerHTML = `
    <div class="promo-panel">
      <button type="button" class="promo-x" data-promo="close" aria-label="닫기">${icon("close", 20)}</button>
      <section class="promo-hero">
        <div class="promo-copy">
          <div class="promo-brand">
            <img src="${iconUrl}" width="56" height="56" alt="" />
            <span><b>맹고</b><small>라씨를 만든 와타랩스의 앱</small></span>
          </div>
          <h2 id="promo-title">출퇴근길,<br />오늘 소식은 귀로 들으세요</h2>
          <p>맹고는 내 관심 분야의 소식만 골라 AI 가 핵심만 요약하고 읽어 주는 앱입니다.</p>
        </div>
        <div class="promo-phone" aria-hidden="true">
          <div class="promo-screen">
            <span class="promo-time">07:30</span>
            <b class="promo-card-title">아침 브리핑</b>
            <span class="promo-card-sub">관심 분야 소식 5건</span>
            <div class="promo-wave">${wave}</div>
            <div class="promo-player"><span class="promo-play"></span><span>02:14 / 04:30</span></div>
            <div class="promo-lines"><i></i><i></i><i class="short"></i></div>
          </div>
        </div>
      </section>
      <ul class="promo-points">
        <li>${icon("summary")}<span><b>핵심만 짧게</b>긴 기사도 짧게 요약하고, 요약마다 원문 링크를 붙입니다</span></li>
        <li>${icon("listen")}<span><b>하루 두 번 브리핑</b>출근길 · 퇴근길, 화면을 꺼도 이어서 읽어 줍니다</span></li>
        <li>${icon("world")}<span><b>해외 소식도 한국어로</b>해외 매체 소식도 한국어로 요약합니다</span></li>
      </ul>
      <div class="promo-get">
        <figure class="promo-qr">
          <img src="${qrUrl}" width="112" height="112" alt="맹고 앱 받기 QR 코드" />
          <figcaption>휴대폰 카메라로 찍으세요</figcaption>
        </figure>
        <div class="promo-actions">
          <p class="promo-get-title">지금 앱을 받아 보세요</p>
          <a class="promo-cta" href="${APP_URL}" target="_blank" rel="noopener">무료로 앱 받기</a>
          <a class="promo-more" href="${INTRO_URL}" target="_blank" rel="noopener">맹고 소개 보기 →</a>
          <span class="promo-note">아이폰 · 안드로이드</span>
        </div>
      </div>
      <div class="promo-foot">
        <button type="button" data-promo="week">1주일간 보지 않기</button>
        <button type="button" data-promo="close" autofocus>닫기</button>
      </div>
    </div>`;
  return dialog;
}

function show(): void {
  const dialog = build();
  const done = (week: boolean) => {
    write(() => sessionStorage, CLOSED_KEY, "1");
    if (week) write(() => localStorage, HIDE_KEY, String(Date.now() + WEEK));
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog) return done(false); // 바깥(어두운 바탕)을 눌렀다
    const action = target.closest<HTMLElement>("[data-promo]")?.dataset.promo;
    if (action) return done(action === "week");
    if (target.closest("a")) done(false); // 맹고로 가는 링크는 새 탭으로 열린다
  });
  dialog.addEventListener("cancel", () => done(false)); // Esc
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function start(): void {
  if (!shouldShow() || typeof HTMLDialogElement !== "function") return;
  // 화면이 먼저 그려진 뒤에 띄운다(편집기는 문서를 여는 동안)
  window.setTimeout(show, 700);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
