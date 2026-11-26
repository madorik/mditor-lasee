import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import type { Dialect } from "../core/inline";
import type { Doc } from "../core/types";
import { fromPM, inlineToMd, inlineToPM, tableMd, toPM } from "./convert";
import fixture from "../fixture.json";
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

describe("고치지 않은 블록은 다시 변환하지 않는다(jsonOf)", () => {
  // 실제 편집처럼 거래를 이어 가며, 기억을 쓴 결과가 매번 새로 변환한 결과와 같은지 본다
  it("표 칸 · 항목 · 문단을 고쳐도 기억해 둔 변환과 새 변환이 같다", async () => {
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");
    const { jsonOf } = await import("./convert");
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(toPM(fixture.doc as Doc)) });
    expect(jsonOf(state.doc)).toEqual(state.doc.toJSON());
    expect(fromPM(jsonOf(state.doc))).toBe(fixture.md);

    // 글이 있는 자리마다(표 칸 · 항목 · 문단 · 제목) 차례로 글자를 넣는다
    const spots: number[] = [];
    state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent) spots.push(pos + 1 + Math.min(2, n.content.size));
    });
    expect(spots.length).toBeGreaterThan(20);
    for (const [k, at] of spots.entries()) {
      const before = jsonOf(state.doc);
      const tr = state.tr.setSelection(TextSelection.create(state.doc, at + k)).insertText(k % 2 ? "가" : "*");
      state = state.apply(tr);
      const after = jsonOf(state.doc);
      expect(fromPM(after)).toBe(fromPM(state.doc.toJSON())); // 기억을 쓴 변환 = 새 변환
      expect(fromPM(after, "en")).toBe(fromPM(state.doc.toJSON(), "en"));
      // 고치지 않은 최상위 블록은 같은 JSON 객체다
      const same = after.content!.filter((c, i) => c === before.content![i]).length;
      expect(same).toBeGreaterThanOrEqual(after.content!.length - 1);
    }
  });

  it("쓰는 쪽이 넘긴 JSON 은 기억하지 않는다 — 고친 뒤 다시 넘기면 고친 대로 나온다", () => {
    const json = toPM({ title: "", dialect: "ko", sections: [{ key: "s1", title: "", blocks: [{ id: "b1", kind: "text", title: null, text: "하나", notes: [] }] }] });
    expect(fromPM(json)).toContain("하나");
    const para = json.content!.find((n) => n.type === "paragraph")!;
    para.content![0].text = "둘";
    expect(fromPM(json)).toContain("둘");
  });
});

describe("표 칸 안의 그림 · 그림 폭", () => {
  it("칸 안의 그림과 본문 그림 폭이 편집기를 거쳐도 그대로다", async () => {
    const { parseMarkdown } = await import("../core/parse");
    const { docToMarkdown } = await import("../core/write");
    const md =
      "## 가\n\n| 사진 | 설명 |\n|:---:|---|\n| ![a](a.png){width=60%} | 첫 줄![b](b.png)뒤 글 |\n| ![c](c.png)![d](d.png){width=30%} | 글<br>둘째 줄 |\n\n![큰 그림](a.png){width=80%}\n";
    const doc = parseMarkdown(md);
    expect(docToMarkdown(doc)).toBe(md);
    const node = schema.nodeFromJSON(toPM(doc));
    node.check(); // 칸에 문단과 그림이 함께 들어가도 스키마에 맞다
    let cellImages = 0;
    node.descendants((n, _p, parent) => {
      if (n.type.name === "mdImage" && parent && (parent.type.name === "tableCell" || parent.type.name === "tableHeader")) cellImages++;
    });
    expect(cellImages).toBe(4);
    expect(fromPM(node.toJSON())).toBe(md);
  });

  it("칸에 그림만 있거나, 문단 사이에 그림이 있어도 MD 로 돌아온다", () => {
    const pm = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "머리" }] }] }] },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "위" }] },
                    { type: "mdImage", attrs: { src: "x.png", caption: "설[명]", width: 45 } },
                    { type: "paragraph" },
                    { type: "paragraph", content: [{ type: "text", text: "{width=10%} 아래" }] },
                  ],
                },
              ],
            },
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "mdImage", attrs: { src: "y.png", caption: "", width: null } }] }] },
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [{ type: "mdImage", attrs: { src: "z.png", caption: "", width: null } }, { type: "paragraph", content: [{ type: "text", text: "{width=20%}" }] }] }],
            },
          ],
        },
      ],
    };
    const md = fromPM(pm);
    expect(md).toContain("| 위![설명](x.png){width=45%}{width=10%} 아래 |"); // 폭이 있는 그림 뒤의 {width=…} 는 글자 그대로 읽힌다
    expect(md).toContain("| ![](y.png) |");
    expect(md).toContain("| ![](z.png)\\{width=20%} |"); // 폭이 없는 그림 바로 뒤의 {width=…} 글자는 이스케이프
    const back = schema.nodeFromJSON(toPM((parseMarkdownSync())(md)));
    back.check();
    expect(fromPM(back.toJSON())).toBe(md);
  });
});

function parseMarkdownSync() {
  // 위 시험에서 쓰는 파서(동적 import 를 피해서)
  return parseMd;
}
import { parseMarkdown as parseMd } from "../core/parse";
