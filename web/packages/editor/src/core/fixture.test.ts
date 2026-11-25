// 화면(TS)의 MD 읽기 · 쓰기가 서버(md.py)와 같은 결과인지 — 공유 기준 파일로 본다.
import { describe, expect, it } from "vitest";
import fixture from "../fixture.json";
import { parseMarkdown } from "./parse";
import type { Doc } from "./types";
import { docToMarkdown } from "./write";

type Loose = { title: string; sections: { title: string; blocks: Record<string, unknown>[] }[]; dialect?: string };

/** id · key 를 뺀 문서(서버 parse 는 id 를 달지 않는다). */
const bare = (d: Doc | Loose): Loose => ({
  title: d.title,
  sections: d.sections.map((s) => ({ title: s.title, blocks: s.blocks.map(({ id: _id, ...b }: Record<string, unknown>) => b) })),
  ...(d.dialect ? { dialect: d.dialect } : {}),
});

const data = fixture as unknown as {
  doc: Doc;
  md: string;
  example: { doc: Doc; md: string };
  en: { doc: Doc; md: string };
  exampleEn: { doc: Doc; md: string };
  parse?: { src: string; dialect: "ko" | "en" | null; doc: Loose }[];
  write?: { doc: Doc; dialect: "ko" | "en" | null; md: string }[];
};

describe("MD 읽기 · 쓰기 — 서버와 같은 결과", () => {
  it("합성 문서 · 예시 문서: 문서 → MD", () => {
    expect(docToMarkdown(data.doc)).toBe(data.md);
    expect(docToMarkdown(data.example.doc)).toBe(data.example.md);
    expect(docToMarkdown(data.en.doc, "en")).toBe(data.en.md);
    expect(docToMarkdown(data.exampleEn.doc, "en")).toBe(data.exampleEn.md);
  });

  it("합성 문서 · 예시 문서: MD → 문서", () => {
    for (const c of [data, data.example, data.en, data.exampleEn]) {
      const { dialect: _d, ...want } = bare(c.doc);
      const { dialect: _g, ...got } = bare(parseMarkdown(c.md));
      expect(got).toEqual(want);
    }
  });

  it("블록 문법 사례 하나하나", () => {
    const cases = data.parse ?? [];
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) {
      expect(bare(parseMarkdown(c.src, c.dialect)), JSON.stringify(c.src)).toEqual(bare(c.doc));
      expect(docToMarkdown(parseMarkdown(c.src, c.dialect)), JSON.stringify(c.src)).toBe(docToMarkdown(c.doc as unknown as Doc));
    }
  });

  it("문서 → MD 사례(번호 · 들여쓰기 · 코드 울타리 · 정렬)", () => {
    const cases = data.write ?? [];
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) expect(docToMarkdown(c.doc, c.dialect ?? undefined), JSON.stringify(c.md)).toBe(c.md);
  });
});
