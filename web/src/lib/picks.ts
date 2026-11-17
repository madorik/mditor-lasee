// 쿠팡 파트너스 추천 칸 — 한국어 정적 쪽(첫 화면·문법·개발자) 아래에 낸다(그리는 곳: ../picks.ts).
//
// 링크(url) 채우는 법: 파트너스의 상품 링크 검색(https://partners.coupang.com/#affiliate/ws/link/0/<search>)에서 본체 가운데
// 많이 팔리는 상품 하나를 골라 '링크 생성'으로 만든 단축 주소(https://link.coupang.com/a/…)를 url 에 넣는다.
// 쿠팡 검색 화면 주소(coupang.com/np/search)로 만든 링크는 일부 브라우저에서 '사용권한이 없습니다'로 막혀서 쓰지 않는다.
// 맥북·맥미니·에어팟은 판매량순 맨 위가 케이스·필름·이어팁 같은 액세서리라 본체를 직접 고른다. 그 모델이 품절되거나 새로 나오면 링크를 바꾼다.
// 비었거나 파트너스 주소가 아닌 칸은 그리지 않고, 하나도 없으면 칸 전체를 그리지 않는다.

export type PickIcon = "laptop" | "mini" | "earbuds" | "keyboard";

export interface Pick {
  id: string;
  icon: PickIcon;
  title: string;
  blurb: string;
  /** 링크를 만들 때 쿠팡에서 찾을 말 */
  search: string;
  /** 파트너스 간편 링크. 비우면 그리지 않는다 */
  url: string;
}

export const PICKS: Pick[] = [
  { id: "macbook", icon: "laptop", title: "맥북", blurb: "글쓰기도 코딩도 가볍게 들고 다니는 노트북", search: "맥북", url: "https://link.coupang.com/a/iKanEsd8w0" },
  { id: "macmini", icon: "mini", title: "맥미니", blurb: "작은 크기에 성능은 넉넉한 데스크톱", search: "맥미니", url: "https://link.coupang.com/a/iKaqzn7V3A" },
  { id: "airpods", icon: "earbuds", title: "에어팟", blurb: "집중해서 쓰고 싶을 때 쓰는 무선 이어폰", search: "에어팟", url: "https://link.coupang.com/a/iKascpRSkm" },
  { id: "keyboard", icon: "keyboard", title: "키보드", blurb: "오래 써도 손이 편한 키보드", search: "키보드", url: "https://link.coupang.com/a/iKatA2GvtY" },
];

/** 쿠팡 파트너스 고지 문구 — 칸 가까이에 눈에 보이게 둔다 */
export const DISCLOSURE = "이 칸은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

const PARTNER_URL = /^https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]+$/;

/** 파트너스 주소가 들어 있는 칸만 */
export function livePicks(list: readonly Pick[] = PICKS): Pick[] {
  return list.filter((p) => PARTNER_URL.test(p.url));
}
