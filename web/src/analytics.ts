// 방문 통계(Vercel Web Analytics) — 쿠키 없이 쪽 주소 · 나라 · 기기 종류를 모아 센다. 모든 쪽(정적 쪽 site.ts, 편집기 main.tsx)이 불러온다.
// 서버가 켠 곳(Vercel 배포, /api/config 의 analytics)에서만 넣는다 — 로컬 · 도커 · e2e 에는 /_vercel/insights 가 없다.
// 주소의 # 뒤는 보내지 않는다: '문서가 든 링크' 는 문서 내용을 # 뒤에 싣는다.
import { inject } from "@vercel/analytics";

const cfg = (window as unknown as { __MDITOR__?: { analytics?: boolean } }).__MDITOR__;
if (cfg?.analytics) {
  inject({ mode: "production", beforeSend: (event) => ({ ...event, url: event.url.split("#")[0] }) });
}
