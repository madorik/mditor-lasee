import { useEffect } from "react";
import type { Config } from "../lib/api";
import { t } from "../lib/i18n";

/** 광고 자리. 광고 설정이 없으면 아무것도 그리지 않는다(주소에 ?ads=demo 를 붙이면 자리만 보여 준다). */
export function AdSlot({ config, slot }: { config: Config; slot: "editor" | "content" }) {
  const client = config.ads.client;
  const id = config.ads[slot];
  const live = !!client && !!id;
  useEffect(() => {
    if (!live) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* 광고 차단 등 */
    }
  }, [live]);
  if (live) {
    return (
      <aside className="ad" aria-label={t("광고")}>
        <ins className="adsbygoogle" style={{ display: "block", height: 90 }} data-ad-client={client} data-ad-slot={id} data-ad-format="horizontal" data-full-width-responsive="true" />
      </aside>
    );
  }
  if (new URLSearchParams(location.search).get("ads") === "demo") return <aside className="ad ad-demo">{t("광고 자리")}</aside>;
  return null;
}
