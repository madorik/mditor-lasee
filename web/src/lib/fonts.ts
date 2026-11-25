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



// 웹 글꼴 정의(@font-face) — 한글 글꼴은 글자 묶음마다 정의가 있어 CSS 가 크다(셋을 합치면 화면 CSS 의 70%).
// 문서에서 고른 글꼴만, 고를 때 불러온다. 글꼴 파일은 그 글자를 그릴 때 받는다.
const CSS: Partial<Record<FontKey, () => Promise<unknown>>> = {
  "nanum-myeongjo": () => Promise.all([import("@fontsource/nanum-myeongjo/400.css"), import("@fontsource/nanum-myeongjo/700.css")]),
  "nanum-gothic": () => Promise.all([import("@fontsource/nanum-gothic/400.css"), import("@fontsource/nanum-gothic/700.css")]),
  "nanum-pen": () => import("@fontsource/nanum-pen-script/400.css"),
};
const loaded = new Set<FontKey>();

/** 문서 글꼴의 웹 글꼴 정의를 불러온다(한 번만). Pretendard 는 화면 글꼴이라 늘 있다. */
export function loadFont(key: FontKey): void {
  if (loaded.has(key)) return;
  loaded.add(key);
  void CSS[key]?.().catch(() => loaded.delete(key));
}

/** 글꼴 고르는 칸을 열 때 — 목록이 각 글꼴로 보이도록 모두 불러온다. */
export const loadAllFonts = (): void => FONTS.forEach(loadFont);
