import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import type { Dialect } from "../inline";
import type { Doc } from "../types";
import { fromPM, inlineToMd, inlineToPM, tableMd, toPM } from "./convert";
import fixture from "./fixture.json";
import { richExtensions } from "./schema";

const schema = getSchema(richExtensions());

/** 문서 → 편집기(스키마 검사까지) → MD */
function through(doc: Doc, dialect: Dialect = "ko"): string {
  const node = schema.nodeFromJSON(toPM(doc));
  node.check();
  return fromPM(node.toJSON(), dialect);
}

describe("문서 → 편집기 → MD 가 서버 MD 와 바이트 단위로 같다", () => {
  it("합성 문서(모서리 모음)", () => {
    expect(through(fixture.doc as Doc)).toBe(fixture.md);
  });

  it("예시 문서", () => {
    expect(through(fixture.example.doc as Doc)).toBe(fixture.example.md);
  });

  it("영어 태그로 쓴 문서 · 영어 예시 문서", () => {
    expect(through(fixture.en.doc as Doc, "en")).toBe(fixture.en.md);
    expect(through(fixture.exampleEn.doc as Doc, "en")).toBe(fixture.exampleEn.md);
  });

  it("글 서식 문자열 하나하나", () => {
    for (const c of fixture.inline) {
      const para = schema.nodeFromJSON({ type: "paragraph", content: inlineToPM(c.canon[0]) });
      expect(inlineToMd(para.toJSON().content), c.src).toBe(c.canon[0]);
      const en = schema.nodeFromJSON({ type: "paragraph", content: inlineToPM(c.canonEn[0]) });
      expect(inlineToMd(en.toJSON().content, null, "en"), c.src).toBe(c.canonEn[0]);
    }
  });

  it("빈 문서", () => {
    expect(through({ title: "", sections: [] })).toBe("");
    expect(through({ title: "제목만", sections: [] })).toBe("# 제목만\n");
  });
});

describe("블록 묶기", () => {
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const item = (text: string, level = 0) => ({ type: "mdItem", attrs: { level }, content: text ? [{ type: "text", text }] : [] });
  const md = (content: object[]) => fromPM({ type: "doc", content });

  it("제목이 새 블록을 열고, 본문은 아직 본문이 없을 때만 붙는다", () => {
    const out = md([
      { type: "blockTitle", content: [{ type: "text", text: "제목" }] },
      p("첫 문단"),
      p("둘째 문단"),
      { type: "mdNote", content: [{ type: "text", text: "비고" }] },
      p("비고 뒤 문단"),
    ]);
    expect(out).toBe("### 제목\n첫 문단\n\n둘째 문단\n> 비고\n\n비고 뒤 문단\n");
  });

  it("맞닿은 목록은 한 블록, 빈 항목은 버리고 단계는 한 칸씩만 깊어진다", () => {
    const out = md([
      { type: "mdList", content: [item("가", 2), item(""), item("나", 3)] },
      { type: "mdList", content: [item("다", 1)] },
    ]);
    expect(out).toBe("- 가\n  - 나\n  - 다\n");
  });

  it("빈 문단은 버린다", () => {
    expect(md([{ type: "paragraph" }, p("  "), p("글")])).toBe("글\n");
  });

  it("글자 그대로의 기호는 이스케이프한다", () => {
    expect(md([p("- 목록 아님"), p("# 제목 아님"), p("**굵게 아님**"), p("---")])).toBe(
      "\\- 목록 아님\n\n\\# 제목 아님\n\n\\*\\*굵게 아님**\n\n\\---\n",
    );
  });
});

describe("표", () => {
  const cell = (type: string, text: string, attrs: object = {}) => ({
    type,
    attrs: { colspan: 1, rowspan: 1, shade: false, align: null, ...attrs },
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });
  const row = (...cells: object[]) => ({ type: "tableRow", content: cells });

  it("합친 칸 · 음영 · 정렬 · 글자 그대로의 기호", () => {
    const t = {
      type: "table",
      attrs: { align: [null, null, null] },
      content: [
        row(cell("tableHeader", "가", { colspan: 2 }), cell("tableHeader", "나")),
        row(cell("tableCell", "1", { rowspan: 2, align: "right" }), cell("tableCell", "<"), cell("tableCell", "a|b", { shade: true })),
        row(cell("tableCell", "2", { align: "center" }), cell("tableCell", "^")),
      ],
    };
    expect(tableMd(t)).toEqual([
      "| 가 | < | 나 |",
      "|---:|---|---|",
      "| 1 | \\< | {음영}a\\|b{/음영} |",
      "| ^ | 2 | \\^ |",
    ]);
  });

  it("본문 행이 없으면 표에 둔 정렬을 쓴다", () => {
    const t = { type: "table", attrs: { align: ["center", null] }, content: [row(cell("tableHeader", "가"), cell("tableHeader", "나"))] };
    expect(tableMd(t)).toEqual(["| 가 | 나 |", "|:---:|---|"]);
  });

  it("칸 안의 문단 여럿은 줄바꿈으로 잇는다", () => {
    const two = {
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, shade: false, align: null },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "위" }] },
        { type: "paragraph", content: [{ type: "text", text: "아래" }] },
      ],
    };
    const t = { type: "table", attrs: { align: [null] }, content: [row(cell("tableHeader", "머리")), row(two)] };
    expect(tableMd(t)).toEqual(["| 머리 |", "|---|", "| 위<br>아래 |"]);
  });
});
