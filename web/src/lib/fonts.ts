// 문서 글꼴 — 쪽 설정에서 문서마다 하나를 고른다. 서버 render.FAMILIES 와 같은 열쇠다.
// 화면은 웹 글꼴로, PDF 는 같은 글꼴 파일로 그린다. 고른 글꼴에 없는 글자(한자 · 기호 등)는 둘 다 Pretendard 로 채운다.

export const FONTS = ["pretendard", "nanum-myeongjo", "nanum-gothic", "nanum-pen"] as const;
export type FontKey = (typeof FONTS)[number];

const FALLBACK = `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic"`;

/** CSS font-family */
export const FONT_CSS: Record<FontKey, string> = {
  pretendard: `${FALLBACK}, sans-serif`,
  "nanum-myeongjo": `"Nanum Myeongjo", ${FALLBACK}, serif`,
  "nanum-gothic": `"Nanum Gothic", ${FALLBACK}, sans-serif`,
  "nanum-pen": `"Nanum Pen Script", ${FALLBACK}, cursive`,
};


