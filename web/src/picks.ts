// 쿠팡 파트너스 추천 칸 — 한국어 정적 쪽(첫 화면·문법·개발자)의 광고 자리 바로 위에 낸다.
// 팝업이 아니라 쪽 아래에 가만히 있는 카드라 읽는 일을 가로막지 않는다. 링크가 하나도 없으면 아무것도 그리지 않는다.
// 목록과 링크 · 사진은 lib/picks.ts. 사진이 없거나 불러오지 못하면 아이콘 카드로 그린다. 편집기(/edit)에는 내지 않는다.
import { liveBanners } from "./lib/banners";
import { DISCLOSURE, livePicks, pickImage, type PickIcon } from "./lib/picks";
import "./styles/picks.css";

const ICONS: Record<PickIcon, string> = {
  // 줄 그림 아이콘(24×24, 선 2px)
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  mini: '<rect x="3" y="10" width="18" height="6" rx="2"/><path d="M12 13h.01"/>',
  earbuds: '<circle cx="9" cy="8" r="4"/><path d="M12.5 10.5V19a1.5 1.5 0 0 1-3 0"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};

const iconSvg = (icon: PickIcon) =>
  `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;

function start(): void {
  if (document.documentElement.lang !== "ko") return;
  if (liveBanners("bottom").length) return; // 쪽 아래 배너(banners.ts)가 있으면 추천 카드 대신 그걸 낸다
  const slot = document.querySelector(".ad-slot");
  const list = livePicks();
  if (!slot || !list.length) return;
  const section = document.createElement("section");
  section.className = "picks";
  section.setAttribute("aria-label", "광고 — 쿠팡 파트너스");
  section.innerHTML = `
    <div class="picks-head"><h2>문서 쓰는 책상에</h2><span class="picks-tag">광고</span></div>
    <ul class="picks-list">${list
      .map((p) => {
        const image = pickImage(p);
        const visual = image
          ? `<span class="pick-img"><img src="${image}" alt="" width="150" height="150" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-icon="${p.icon}" /></span>`
          : iconSvg(p.icon);
        return `
      <li><a class="pick${image ? " has-img" : ""}" href="${p.url}" target="_blank" rel="sponsored nofollow noopener">
        ${visual}
        <span class="pick-text"><b>${p.title}</b><span>${p.blurb}</span><em>쿠팡에서 보기 →</em></span>
      </a></li>`;
      })
      .join("")}
    </ul>
    <p class="picks-note">${DISCLOSURE}</p>`;
  // 사진을 불러오지 못하면(주소가 바뀌었거나 막혔거나) 빈 칸 대신 아이콘 카드로 되돌린다
  for (const img of section.querySelectorAll<HTMLImageElement>(".pick-img img")) {
    img.addEventListener(
      "error",
      () => {
        const card = img.closest<HTMLElement>(".pick");
        if (!card) return;
        card.classList.remove("has-img");
        img.closest(".pick-img")?.remove();
        card.insertAdjacentHTML("afterbegin", iconSvg(img.dataset.icon as PickIcon));
      },
      { once: true },
    );
  }
  slot.before(section);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
