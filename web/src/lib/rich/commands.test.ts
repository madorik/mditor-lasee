import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, type Command } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import type { Doc } from "../types";
import { addRowBelow, backspaceItem, headRows, mergeSafe, setBlockKind, setColumnAlign, shiftItem, splitItem, toggleCellShade } from "./commands";
import { fromPM, toPM } from "./convert";
import { richExtensions } from "./schema";

const schema = getSchema(richExtensions());

function open(doc: Doc): EditorState {
  return EditorState.create({ doc: schema.nodeFromJSON(toPM(doc)) });
}

/** 글자 `needle` 바로 뒤(또는 앞)에 커서를 둔다. */
function at(state: EditorState, needle: string, after = true): EditorState {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle) + (after ? needle.length : 0);
  });
  if (found < 0) throw new Error(`not found: ${needle}`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, found)));
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  const ok = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  if (!ok) throw new Error("command refused");
  next.doc.check();
  return next;
}

const md = (state: EditorState) => fromPM(state.doc.toJSON());
const sec = (blocks: object[]): Doc => ({ title: "", sections: [{ key: "s", title: "", blocks }] }) as Doc;
const list = (...items: [string, number][]) => ({ id: "b", kind: "list", title: null, items: items.map(([text, level]) => ({ text, level })), notes: [] });
const text = (t: string) => ({ id: "t" + t, kind: "text", title: null, text: t, notes: [] });
const table = () => ({
  id: "t", kind: "table", title: null, notes: [],
  head: [["가", "나", "다"]],
  rows: [["1", "2", "3"], ["4", "5", "6"]],
  align: [null, "right", null],
});

function cellPos(state: EditorState, needle: string): number {
  const s = at(state, needle);
  return s.selection.$from.before(s.selection.$from.depth - 1);
}

describe("목록", () => {
  it("Enter 는 같은 단계의 항목을 만든다", () => {
    const s = run(at(open(sec([list(["가", 0], ["나다", 1])])), "나"), splitItem);
    expect(md(s)).toBe("- 가\n  - 나\n  - 다\n");
  });

  it("빈 항목에서 Enter — 단계를 내리고, 맨 바깥이면 목록 밖 문단이 된다", () => {
    let s = open(sec([list(["가", 0], ["나", 1])]));
    s = run(at(s, "나"), splitItem); // 새 빈 항목(단계 1)
    s = run(s, splitItem); // 단계 0
    expect(s.selection.$from.parent.attrs.level).toBe(0);
    s = run(s, splitItem); // 목록 밖
    expect(s.selection.$from.parent.type.name).toBe("paragraph");
    expect(md(s)).toBe("- 가\n  - 나\n");
  });

  it("Tab 은 앞 항목보다 한 단계까지만", () => {
    let s = at(open(sec([list(["가", 0], ["나", 0])])), "나");
    s = run(s, shiftItem(1));
    s = run(s, shiftItem(1));
    expect(md(s)).toBe("- 가\n  - 나\n");
    expect(md(run(s, shiftItem(-1)))).toBe("- 가\n- 나\n");
  });

  it("첫 항목 맨 앞에서 Backspace — 문단으로 꺼낸다", () => {
    const s = run(at(open(sec([list(["가", 0], ["나", 0])])), "가", false), backspaceItem);
    expect(md(s)).toBe("가\n\n- 나\n");
  });
});

describe("블록 종류", () => {
  it("문단 → 목록 → 문단", () => {
    let s = at(open(sec([text("가"), text("나")])), "나");
    s = run(s, setBlockKind("list"));
    expect(md(s)).toBe("가\n\n- 나\n");
    expect(s.selection.$from.parent.type.name).toBe("mdItem");
    expect(md(run(s, setBlockKind("list")))).toBe("가\n\n나\n");
  });

  it("목록 옆 문단을 목록으로 바꾸면 한 목록이 된다", () => {
    const s = run(at(open(sec([list(["가", 0]), text("나")])), "나"), setBlockKind("list"));
    expect(s.doc.childCount).toBe(1);
    expect(md(s)).toBe("- 가\n- 나\n");
  });

  it("목록 가운데 항목을 제목으로 — 목록이 둘로 갈린다", () => {
    const s = run(at(open(sec([list(["가", 0], ["나", 0], ["다", 1])])), "나"), setBlockKind("blockTitle"));
    expect(md(s)).toBe("- 가\n\n### 나\n- 다\n");
  });

  it("제목으로 바꿔도 서식이 남는다(제목에도 서식을 쓴다)", () => {
    const s = run(at(open(sec([text("**굵게** {기울임}글{/기울임}")])), "글"), setBlockKind("sectionHead"));
    expect(md(s)).toBe("## **굵게** {기울임}글{/기울임}\n");
  });

  it("문서 제목은 맨 앞 블록만", () => {
    const s = at(open(sec([text("가"), text("나")])), "나");
    expect(setBlockKind("docTitle")(s)).toBe(false);
    expect(md(run(at(s, "가"), setBlockKind("docTitle")))).toBe("# 가\n\n나\n");
  });
});

describe("표", () => {
  it("머리글 칸과 본문 칸이 섞이면 합치기를 거부한다", () => {
    const s = open(sec([table()]));
    const mixed = s.apply(s.tr.setSelection(CellSelection.create(s.doc, cellPos(s, "가"), cellPos(s, "1"))));
    expect(mergeSafe(mixed)).toBe(false);
    const body = s.apply(s.tr.setSelection(CellSelection.create(s.doc, cellPos(s, "1"), cellPos(s, "5"))));
    const merged = run(body, mergeSafe);
    expect(md(merged)).toContain("| 1<br>2<br>4<br>5 | < | 3 |\n| ^ | ^ | 6 |\n");
  });

  it("열 정렬 — 다시 누르면 기본으로", () => {
    let s = at(open(sec([table()])), "5");
    s = run(s, setColumnAlign("center"));
    expect(md(s)).toContain("|---|:---:|---|");
    expect(md(run(s, setColumnAlign("center")))).toContain("|---|---|---|");
  });

  it("칸 음영", () => {
    const s = run(at(open(sec([table()])), "5"), toggleCellShade);
    expect(md(s)).toContain("| 4 | {음영}5{/음영} | 6 |");
  });

  it("머리글 마지막 행 아래에 넣은 행은 본문 칸이고 열 정렬을 이어받는다", () => {
    const s = run(at(open(sec([table()])), "나"), addRowBelow);
    const t = s.doc.child(0);
    expect(headRows(t)).toBe(1);
    expect(t.childCount).toBe(4);
    expect(md(s)).toBe("| 가 | 나 | 다 |\n|---|---:|---|\n|  |  |  |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n");
  });
});
