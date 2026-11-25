import { useEffect, useRef, useState } from "react";
import type { Config } from "../lib/api";
import { t } from "../lib/i18n";

/**
 * 광고 자리. 광고 설정이 없으면 아무것도 그리지 않는다(주소에 ?ads=demo 를 붙이면 자리만 보여 준다).
 * 광고가 실제로 채워졌을 때(AdSense 가 data-ad-status="filled" 를 단다)만 자리를 펼친다 — 광고가 오지 않으면 빈 띠를 남기지 않는다.
 */
export function AdSlot({ config, slot }: { config: Config; slot: "editor" | "content" }) {
  const client = config.ads.client;
  const id = config.ads[slot];
  const live = !!client && !!id;
  const ins = useRef<HTMLModElement>(null);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!live) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* 광고 차단 등 */
    }
    const el = ins.current;
    if (!el) return;
    const watch = new MutationObserver(() => setFilled(el.getAttribute("data-ad-status") === "filled"));
    watch.observe(el, { attributes: true, attributeFilter: ["data-ad-status"] });
    // 광고를 못 채우면 AdSense 가 바깥 요소(.app · #root)에 height: auto !important 를 박는다 — 화면 높이에 맞춘 편집 화면이
    // 늘어나 글자 수 줄이 화면 밖으로 밀렸다. 바깥 요소의 높이는 우리 CSS 가 정하므로, 박힌 높이는 곧바로 지운다.
    const outer: HTMLElement[] = [];
    for (let p = el.parentElement?.parentElement ?? null; p && p !== document.body; p = p.parentElement) outer.push(p);
    const keep = new MutationObserver(() => {
      for (const p of outer) if (p.style.height) p.style.removeProperty("height");
    });
    for (const p of outer) keep.observe(p, { attributes: true, attributeFilter: ["style"] });
    return () => {
      watch.disconnect();
      keep.disconnect();
    };
  }, [live]);
  if (live) {
    return (
      <aside className="ad" data-filled={filled || undefined} aria-label={t("광고")} aria-hidden={!filled || undefined}>
        <ins ref={ins} className="adsbygoogle" style={{ display: "block", height: 90 }} data-ad-client={client} data-ad-slot={id} data-ad-format="horizontal" data-full-width-responsive="true" />
      </aside>
    );
  }
  if (new URLSearchParams(location.search).get("ads") === "demo") return <aside className="ad ad-demo">{t("광고 자리")}</aside>;
  return null;
}
