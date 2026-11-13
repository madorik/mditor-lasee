// 정적 쪽의 작은 스크립트 — 주소 채우기, 첫 화면 영상, 광고 자리, 맹고 소개 팝업.
import "./analytics";
import "./styles/site.css";
import "./promo";

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

// 첫 화면 영상 — 움직임 줄이기를 켠 사람에게는 틀지 않고 포스터만 보인다(직접 틀 수 있게 단추는 준다).
const still = matchMedia("(prefers-reduced-motion: reduce)");
const holdVideos = () => {
  if (!still.matches) return;
  for (const v of document.querySelectorAll<HTMLVideoElement>(".hero-video video")) {
    if (!v.autoplay) continue;
    v.autoplay = false;
    v.pause();
    v.controls = true;
    v.load(); // 처음 상태로 — 이미 그린 첫 장면 대신 포스터가 다시 보인다
  }
};
holdVideos();
still.addEventListener("change", holdVideos);

// 광고 — 설정이 있을 때만 자리를 연다. 없으면 빈 상자를 남기지 않는다.
const demo = new URLSearchParams(location.search).get("ads") === "demo";
const adLabel: Record<string, string> = { ko: "광고 자리", en: "Ad slot" };
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
    el.textContent = adLabel[document.documentElement.lang] ?? adLabel.ko;
    el.classList.add("demo");
    el.hidden = false;
  }
}
