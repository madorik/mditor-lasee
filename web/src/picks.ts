// 쿠팡 파트너스 추천 칸 — 한국어 정적 쪽(첫 화면·문법·개발자)의 광고 자리 바로 위에 낸다.
// 팝업이 아니라 쪽 아래에 가만히 있는 카드라 읽는 일을 가로막지 않는다. 링크가 하나도 없으면 아무것도 그리지 않는다.
// 목록과 링크는 lib/picks.ts. 편집기(/edit)에는 내지 않는다.
import { DISCLOSURE, livePicks, type PickIcon } from "./lib/picks";
import "./styles/picks.css";

const ICONS: Record<PickIcon, string> = {
  // 줄 그림 아이콘(24×24, 선 2px)
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  mini: '<rect x="3" y="10" width="18" height="6" rx="2"/><path d="M12 13h.01"/>',
  earbuds: '<circle cx="9" cy="8" r="4"/><path d="M12.5 10.5V19a1.5 1.5 0 0 1-3 0"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};

function start(): void {
  if (document.documentElement.lang !== "ko") return;
  const slot = document.querySelector(".ad-slot");
  const list = livePicks();
  if (!slot || !list.length) return;
  const section = document.createElement("section");
  section.className = "picks";
  section.setAttribute("aria-label", "광고 — 쿠팡 파트너스");
  section.innerHTML = `
    <div class="picks-head"><h2>문서 쓰는 책상에</h2><span class="picks-tag">광고</span></div>
    <ul class="picks-list">${list
      .map(
        (p) => `
      <li><a class="pick" href="${p.url}" target="_blank" rel="sponsored nofollow noopener">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[p.icon]}</svg>
        <span class="pick-text"><b>${p.title}</b><span>${p.blurb}</span><em>쿠팡에서 보기 →</em></span>
      </a></li>`,
      )
      .join("")}
    </ul>
    <p class="picks-note">${DISCLOSURE}</p>`;
  slot.before(section);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
