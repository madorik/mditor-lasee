import { describe, expect, it } from "vitest";
import { lang, langPath, localPath, otherLang, t, translate } from "./i18n";
import { en } from "./i18n/en";

// 화면 글을 쓰는 파일 전부(시험 파일과 i18n 자체는 뺀다)
const sources = import.meta.glob(["../editor/**/*.{ts,tsx}", "./**/*.{ts,tsx}", "!./**/*.test.ts", "!./i18n.ts", "!./i18n/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** t("…") 의 열쇠를 모은다. 첫 인자가 큰따옴표 글자가 아니면 실패 — 그래야 빠짐없이 찾는다. */
function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/(?<![\w$.])t\(/g)) {
      const rest = src.slice(m.index + m[0].length);
      const lit = rest.match(/^\s*"((?:[^"\\\n]|\\.)*)"/);
      if (!lit) throw new Error(`${file}: t( 의 첫 인자는 큰따옴표 글자 그대로여야 합니다 — ${rest.slice(0, 60)}`);
      const key = JSON.parse(`"${lit[1]}"`) as string;
      found.set(key, [...(found.get(key) ?? []), file]);
    }
  }
  return found;
}

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("화면 글 번역", () => {
  const used = scan();

  it("편집기 파일에서 t(\"…\") 를 찾는다", () => {
    expect(Object.keys(sources).some((f) => f.endsWith("Workspace.tsx"))).toBe(true);
    expect(used.size).toBeGreaterThan(100);
  });

  it("쓰는 글은 모두 영어 사전에 있다", () => {
    const missing = [...used.keys()].filter((k) => !(k in en)).map((k) => `${JSON.stringify(k)} (${[...new Set(used.get(k))].join(", ")})`);
    expect(missing, "en.ts 에 빠진 열쇠").toEqual([]);
  });

  it("사전에 쓰지 않는 열쇠가 남아 있지 않다", () => {
    expect(Object.keys(en).filter((k) => !used.has(k)), "en.ts 에 남은 열쇠").toEqual([]);
  });

  it("번역에도 같은 {자리} 가 있다", () => {
    const bad = Object.entries(en).filter(([ko, v]) => holes(ko).join() !== holes(v).join());
    expect(bad).toEqual([]);
  });

  it("번역 · 자리 채우기 · 없으면 한국어", () => {
    expect(translate("en", "저장")).toBe("Save");
    expect(translate("en", "{n}쪽", { n: 3 })).toBe("Page 3");
    expect(translate("ko", "{n}쪽", { n: 3 })).toBe("3쪽");
    expect(translate("en", "사전에 없는 글 {x}", { x: 1 })).toBe("사전에 없는 글 1");
    expect(translate("en", "판본 {n}", {})).toBe("Version {n}"); // 채울 값이 없으면 자리를 그대로 둔다
    expect(translate("ko", "{밑줄}{a}", { a: "{b}" })).toBe("{밑줄}{b}"); // 한글 태그는 자리가 아니고, 채운 값은 다시 보지 않는다
  });

  it("node(document 없음)에서는 한국어", () => {
    expect(lang).toBe("ko");
    expect(otherLang).toBe("en");
    expect(t("저장")).toBe("저장");
    expect(localPath("/syntax")).toBe("/syntax");
  });

  it("언어별 주소", () => {
    expect(langPath("en", "/")).toBe("/en/");
    expect(langPath("en", "/syntax")).toBe("/en/syntax");
    expect(langPath("en", "/edit")).toBe("/en/edit");
    expect(langPath("ko", "/edit")).toBe("/edit");
    expect(langPath("ko", "/")).toBe("/");
  });
});
