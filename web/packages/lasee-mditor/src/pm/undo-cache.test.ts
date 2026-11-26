import { getSchema } from "@tiptap/core";
import { history, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../core/parse";
import { fromPM, jsonOf, toPM } from "./convert";
import { richExtensions } from "./schema";

const schema = getSchema(richExtensions());

describe("되돌리기 뒤에도 변환이 맞다(노드별 기억)", () => {
  it("칸 안 그림의 폭을 바꿨다가 되돌리면 MD 도 돌아온다", () => {
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(toPM(parseMarkdown("# 시험\n\n| a |\n|---|\n| 글![](x.png){width=40%} |\n"))), plugins: [history()] });
    const before = fromPM(jsonOf(state.doc));
    expect(before).toContain("{width=40%}");
    let at = -1;
    state.doc.descendants((n, p) => {
      if (n.type.name === "mdImage") at = p;
    });
    state = state.apply(state.tr.setNodeMarkup(at, undefined, { ...state.doc.nodeAt(at)!.attrs, width: null }));
    expect(fromPM(jsonOf(state.doc))).not.toContain("{width=");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(fromPM(state.doc.toJSON())).toBe(before); // 새로 변환하면 맞다
    expect(fromPM(jsonOf(state.doc))).toBe(before); // 기억을 써도 맞아야 한다
  });
});
