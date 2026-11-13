// 정적 쪽의 작은 스크립트 — 주소 채우기와 광고 자리.
import "./styles/site.css";

type Cfg = { publicUrl?: string; contact?: string; ads?: { client?: string; content?: string } };
const cfg: Cfg = (window as unknown as { __MDITOR__?: Cfg }).__MDITOR__ ?? {};
const origin = cfg.publicUrl || location.origin;

// 예시 코드 속의 {origin} 을 실제 주소로
for (const el of document.querySelectorAll<HTMLElement>("[data-fill]")) {
  el.textContent = (el.textContent ?? "").replaceAll("{origin}", origin);
}

// 문의처
for (const el of document.querySelectorAll<HTMLElement>("[data-contact]")) {
  if (cfg.contact) {
    const a = document.createElement("a");
    a.href = `mailto:${cfg.contact}`;
    a.textContent = cfg.contact;
    el.replaceChildren(a);
  }
}

// 광고 — 설정이 있을 때만 자리를 연다. 없으면 빈 상자를 남기지 않는다.
const demo = new URLSearchParams(location.search).get("ads") === "demo";
for (const el of document.querySelectorAll<HTMLElement>(".ad-slot")) {
  if (cfg.ads?.client && cfg.ads.content) {
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.dataset.adClient = cfg.ads.client;
    ins.dataset.adSlot = cfg.ads.content;
    ins.dataset.adFormat = "auto";
    ins.dataset.fullWidthResponsive = "true";
    el.append(ins);
    el.hidden = false;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      /* 광고 차단 등 */
    }
  } else if (demo) {
    el.textContent = "광고 자리";
    el.classList.add("demo");
    el.hidden = false;
  }
}
