import { describe, expect, it } from "vitest";
import { editorMarks, pageBreaks } from "./pages";
import type { Doc, PageLayout } from "./types";

const doc = {
  title: "",
  sections: [
    {
      key: "s1",
      title: "하나",
      blocks: [
        { id: "a", kind: "list", title: null, notes: [], items: [0, 1, 2, 3].map((i) => ({ text: String(i), level: 0 })) },
        { id: "t", kind: "table", title: null, notes: [], head: [["h"]], rows: [["1"], ["2"], ["3"]], align: [null] },
      ],
    },
    { key: "s2", title: "둘", blocks: [{ id: "p", kind: "text", title: null, notes: [], text: "글" }] },
  ],
} as Doc;

describe("쪽 경계", () => {
  it("쪽 번호가 바뀌는 자리만 표시한다", () => {
    const layout: PageLayout = {
      sections: { s1: 1, s2: 4 },
      blocks: { a: 1, t: 2, p: 4 },
      items: { a: { "0": 1, "1": 1, "2": 2, "3": 2 } },
      rows: { t: { "0": 2, "2": 3 } },
      total: 4,
    };
    const got = pageBreaks(doc, layout);
    expect(got.blocks.a).toEqual({ before: null, items: { 2: 2 }, rows: {} });
    expect(got.blocks.t).toEqual({ before: null, items: {}, rows: { 2: 3 } }); // 2쪽은 목록 안에서 이미 넘어갔다
    expect(got.sections).toEqual({ s2: 4 });
    expect(got.blocks.p.before).toBeNull(); // 섹션 머리에서 이미 표시했다
  });

  it("배치가 없으면 경계도 없다", () => {
    expect(pageBreaks(doc, null)).toEqual({ sections: {}, blocks: {} });
  });

  it("편집기 쪽 경계는 섹션 · 블록 순번으로 옮긴다", () => {
    const layout: PageLayout = {
      sections: { s1: 1, s2: 4 },
      blocks: { a: 1, t: 2, p: 4 },
      items: { a: { "0": 1, "1": 1, "2": 2, "3": 2 } },
      rows: { t: { "0": 2, "2": 3 } },
      total: 4,
    };
    expect(editorMarks(doc, layout)).toEqual({
      total: 4,
      sections: { 1: 4 },
      blocks: { 0: { before: null, items: { 2: 2 }, rows: {} }, 1: { before: null, items: {}, rows: { 2: 3 } } },
    });
    expect(editorMarks(doc, null)).toBeNull();
  });
});
