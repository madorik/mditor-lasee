// 쿠팡 파트너스 다이나믹 배너 — 파트너스 > 다이나믹 배너에서 만든 코드를 html 에 '그대로' 붙인다(스크립트 두 줄이든 iframe 이든).
// 화면을 덮거나 스크롤을 따라다니는 배너(팝업 · 플로팅 · 커버형)는 쿠팡 파트너스가 금지해서 쓰지 않는다 — 모두 쪽 안에 가만히 있는 배너다.
// 자리(그리는 곳: ../banners.ts, 한국어 정적 쪽만 — 편집기 · 영어 쪽에는 내지 않는다):
//   middle  한국어 첫 화면의 첫 소개 바로 아래(680×140 으로 만들고, 그릴 때 폭은 자리에 맞춘다 — fitWidth)
//   bottom  첫 화면 · 문법 · 개발자 쪽의 광고 자리 위(같다). 있으면 추천 카드(lib/picks.ts) 대신 그린다
//   side    화면 폭 1500px 이상일 때만, 본문 오른쪽 옆(160×600). 쪽과 같이 올라가고 따라다니지 않는다
// 쿠팡 코드는 쪽에 직접 심는다(banners.ts). 우리 iframe · sandbox · data: 주소 안에 넣거나 쿠팡 위젯 주소를 직접 쓰면 쿠팡 위젯이 내용을 줄여서
// 그린다(사진 29장 → 1장, 2026-11-17 에 모두 해 봄 — 쿠팡이 '다른 틀 안(depth)'인지 보는 것으로 보인다). 그래서 보안 격리는 없다:
// 쿠팡 스크립트는 이 사이트와 같은 출처에서 돌아 브라우저 저장소에 닿을 수 있다(구글 애드센스 스크립트가 모든 쪽에 이미 그렇듯).
// 격리하려면 다른 출처의 호스트에서 서빙해야 한다. 편집기(/edit)에는 쿠팡 스크립트를 싣지 않는다.
// html 이 비었거나 쿠팡 주소가 아닌 곳을 부르면 그 배너는 그리지 않는다.

//   export  한국어 편집기에서 '내보내기'(PDF · MD · 링크)를 하면 열리는 안내 창 안(680×140) — 편집기의 유일한 쿠팡 배너. 그 창이 열릴 때만 불러온다
export type BannerSlot = "middle" | "bottom" | "side" | "export";

export interface Banner {
  slot: BannerSlot;
  /** 파트너스가 준 코드 그대로 */
  html: string;
  /** 파트너스 배너 설정의 너비 · 높이(px) */
  width: number;
  height: number;
}

/** 파트너스에서 만들 때 넣는 크기(안내용) */
export const SIZES: Record<BannerSlot, [number, number]> = { middle: [680, 140], bottom: [680, 140], side: [160, 600], export: [680, 140] };

export const BANNERS: Banner[] = [
  // 첫 화면 중간('라씨-중간2', 캐러셀 680×140). 하단(id 1051309)과 다른 배너라 첫 화면에서 서로 다른 상품이 나온다
  {
    slot: "middle",
    width: 680,
    height: 140,
    html: `<script src="https://ads-partners.coupang.com/g.js"></script>
<script>
	new PartnersCoupang.G({"id":1051316,"template":"carousel","trackingCode":"AF2969243","width":"680","height":"140","tsource":""});
</script>`,
  },
  // 쪽 아래(광고 자리 위, '라씨-하단', 캐러셀 680×140)
  {
    slot: "bottom",
    width: 680,
    height: 140,
    html: `<script src="https://ads-partners.coupang.com/g.js"></script>
<script>
	new PartnersCoupang.G({"id":1051309,"template":"carousel","trackingCode":"AF2969243","width":"680","height":"140","tsource":""});
</script>`,
  },
  // 본문 오른쪽 옆('라씨-옆2', 160×600)
  {
    slot: "side",
    width: 160,
    height: 600,
    html: `<script src="https://ads-partners.coupang.com/g.js"></script>
<script>
	new PartnersCoupang.G({"id":1051316,"template":"carousel","trackingCode":"AF2969243","width":"160","height":"600","tsource":""});
</script>`,
  },
  // 편집기 내보내기 안내 창('라씨-내보내기', 캐러셀 680×140)
  {
    slot: "export",
    width: 680,
    height: 140,
    html: `<script src="https://ads-partners.coupang.com/g.js"></script>
<script>
	new PartnersCoupang.G({"id":1051316,"template":"carousel","trackingCode":"AF2969243","width":"680","height":"140","tsource":""});
</script>`,
  },
  // 예) { slot: "bottom", width: 680, height: 140, html: `<script src="https://ads-partners.coupang.com/g.js"></script><script>new PartnersCoupang.G({…})</script>` },
];

const URL_IN_CODE = /(?:https?:)?\/\/[^\s"'<>()\\]+/gi;
const ALLOWED_HOST = /(^|\.)(coupang\.com|coupangcdn\.com)$/;

/** 코드 안의 모든 주소가 쿠팡 것인지(그 밖의 곳을 부르는 코드는 받지 않는다) */
export function isSafeSnippet(html: string): boolean {
  if (!html.trim()) return false;
  for (const m of html.match(URL_IN_CODE) ?? []) {
    try {
      if (!ALLOWED_HOST.test(new URL(m.startsWith("//") ? `https:${m}` : m).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** 쪽 안 가로 배너의 폭 범위(px) — 그 사이에서 자리 폭에 맞춘다. 캐러셀은 폭이 넓으면 상품을 더 많이 보여 준다 */
export const INLINE_WIDTH: readonly [number, number] = [300, 1200];

/** 자리 폭 → 배너 폭(범위 안의 정수) */
export function fitWidth(room: number, [min, max]: readonly [number, number] = INLINE_WIDTH): number {
  return Math.round(Math.min(max, Math.max(min, room || min)));
}

/** 다이나믹 배너 코드의 폭을 바꾼다(PartnersCoupang.G 의 "width"). 다른 곳은 그대로라 쿠팡 주소만 부르는 것도 그대로다 */
export function withWidth(html: string, width: number): string {
  return html.replace(/("width"\s*:\s*")\d+(")/, `$1${width}$2`);
}

/** 그 자리의 그릴 수 있는 배너(크기가 올바르고 코드가 쿠팡 것인 것) */
export function liveBanners(slot: BannerSlot, list: readonly Banner[] = BANNERS): Banner[] {
  return list.filter((b) => b.slot === slot && Number.isInteger(b.width) && Number.isInteger(b.height) && b.width > 0 && b.height > 0 && isSafeSnippet(b.html));
}
