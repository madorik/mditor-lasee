// 화면 글의 언어 — 쪽의 <html lang> 이 정한다(한국어는 /edit, 영어는 /en/edit).
// gettext 처럼 한국어 원문이 열쇠다: t("저장") → 영어 화면이면 "Save". 사전에 없으면 한국어 그대로.
// 새 글은 반드시 t("…") 꼴(첫 인자는 큰따옴표 글자 그대로)로 쓴다 — i18n.test.ts 가 사전에 빠진 것을 찾는다.

import { en } from "./i18n/en";

export type Lang = "ko" | "en";
export const LANGS: readonly Lang[] = ["ko", "en"];

/** 언어 이름 — 각 언어로 적는다(언어 바꾸기 단추에 쓴다). */
export const LANG_NAMES: Record<Lang, string> = { ko: "한국어", en: "English" };

const DICTS: Record<Lang, Record<string, string> | null> = { ko: null, en };

function detect(): Lang {
  if (typeof document === "undefined") return "ko"; // vitest(node) 등
  const code = (document.documentElement.lang || "").toLowerCase().split("-")[0];
  return (LANGS as readonly string[]).includes(code) ? (code as Lang) : "ko";
}

export const lang: Lang = detect();
/** 다른 언어(지금은 둘뿐이다). */
export const otherLang: Lang = lang === "ko" ? "en" : "ko";

/** {이름} 자리를 채운다. vars 에 없는 자리는 그대로 둔다. */
function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** 정한 언어로 옮긴다(시험용 · 다른 언어 쪽 만들 때). */
export function translate(to: Lang, ko: string, vars?: Record<string, string | number>): string {
  return fill(DICTS[to]?.[ko] ?? ko, vars);
}

/** 화면 글. 열쇠는 한국어 원문, {이름} 은 vars 로 채운다. */
export function t(ko: string, vars?: Record<string, string | number>): string {
  return translate(lang, ko, vars);
}

/** 그 언어의 쪽 주소 — 한국어는 뿌리, 다른 언어는 /<언어>/ 아래: ("en", "/syntax") → "/en/syntax", ("en", "/") → "/en/". */
export function langPath(to: Lang, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return to === "ko" ? p : `/${to}${p}`;
}

/** 지금 언어의 쪽 주소. */
export function localPath(path: string): string {
  return langPath(lang, path);
}
