// 편집기 명령 — ProseMirror 명령(state, dispatch) 꼴이라 화면 없이도 시험할 수 있다.

import type { Node as PMNode, NodeType, Schema } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection, type Command, type EditorState, type Transaction } from "@tiptap/pm/state";
import { addRow, CellSelection, mergeCells, selectedRect, TableMap } from "@tiptap/pm/tables";

export type CellAlign = "left" | "center" | "right";
export type BlockKind = "paragraph" | "docTitle" | "sectionHead" | "blockTitle" | "mdNote" | "list";

const MAX_LEVEL = 3;
const TEXTBLOCKS = ["paragraph", "docTitle", "sectionHead", "blockTitle", "mdNote"];

// ───────────── 표 ─────────────

/** 머리글 행 수 = 앞에서부터 연속으로 칸이 전부 머리글인 행(최소 1). */
export function headRows(table: PMNode): number {
  let n = 0;
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r);
    let all = true;
    row.forEach((cell) => {
      if (cell.type.name !== "tableHeader") all = false;
    });
    if (!all) break;
    n++;
  }
  return Math.max(1, n);
}

/** 칸 합치기 — 머리글 칸과 본문 칸이 섞이면 거부한다(머리글과 본문은 따로 합친다). */
export const mergeSafe: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;
  const rect = selectedRect(state);
  const heads = headRows(rect.table);
  if (rect.top < heads && rect.bottom > heads) return false;
  return mergeCells(state, dispatch);
};

function cellsInColumns(state: EditorState): { pos: number; node: PMNode }[] | null {
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }
  const seen = new Set<number>();
  const out: { pos: number; node: PMNode }[] = [];
  for (let row = 0; row < rect.map.height; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const rel = rect.map.map[row * rect.map.width + col];
      if (seen.has(rel)) continue;
      seen.add(rel);
      const node = rect.table.nodeAt(rel);
      if (node) out.push({ pos: rect.tableStart + rel, node });
    }
  }
  return out;
}

/** 열 정렬 — 고른 열의 모든 칸에 건다. 같은 정렬을 다시 누르면 기본으로 돌아간다. */
export function setColumnAlign(align: CellAlign): Command {
  return (state, dispatch) => {
    const cells = cellsInColumns(state);
    if (!cells?.length) return false;
    const next = cells.every((c) => c.node.attrs.align === align) ? null : align;
    if (dispatch) {
      const tr = state.tr;
      cells.forEach((c) => tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, align: next }));
      dispatch(tr);
    }
    return true;
  };
}

/** 칸 음영 — 고른 칸들의 배경을 켜고 끈다. */
export const toggleCellShade: Command = (state, dispatch) => {
  const cells: { pos: number; node: PMNode }[] = [];
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    sel.forEachCell((node, pos) => cells.push({ pos, node }));
  } else {
    const { $from } = sel;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
        cells.push({ pos: $from.before(d), node });
        break;
      }
    }
  }
  if (!cells.length) return false;
  const on = !cells.every((c) => c.node.attrs.shade);
  if (dispatch) {
    const tr = state.tr;
    cells.forEach((c) => tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, shade: on }));
    dispatch(tr);
  }
  return true;
};

/** 아래에 행 넣기 — 머리글 마지막 행 아래에 넣은 행은 본문 칸으로 만들고, 열 정렬을 이어받는다. */
export const addRowBelow: Command = (state, dispatch) => {
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return false;
  }
  if (dispatch) {
    const heads = headRows(rect.table);
    const index = rect.bottom;
    const tr = addRow(state.tr, rect, index);
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (table) {
      const map = TableMap.get(table);
      const cellType = state.schema.nodes.tableCell;
      const from = Math.min(table.childCount - 1, index + (index + 1 < table.childCount ? 1 : -1)); // 정렬을 본뜰 본문 행
      const seen = new Set<number>();
      for (let col = 0; col < map.width; col++) {
        const rel = map.map[index * map.width + col];
        if (seen.has(rel)) continue;
        seen.add(rel);
        const node = table.nodeAt(rel);
        if (!node || map.findCell(rel).top !== index) continue; // 위에서 내려온 합친 칸
        const model = from >= heads && from !== index ? table.nodeAt(map.map[from * map.width + col]) : null;
        const type = index >= heads ? cellType : node.type;
        tr.setNodeMarkup(rect.tableStart + rel, type, { ...node.attrs, align: model?.attrs.align ?? node.attrs.align });
      }
    }
    dispatch(tr);
  }
  return true;
};

// ───────────── 목록 ─────────────

function inItem(state: EditorState) {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "mdItem") return null;
  const d = $from.depth - 1;
  return { item: $from.parent, list: $from.node(d), listPos: $from.before(d), index: $from.index(d), offset: $from.parentOffset };
}

function plain(node: PMNode, schema: Schema): Fragment {
  const text = node.textBetween(0, node.content.size, " ", " ");
  return text ? Fragment.from(schema.text(text)) : Fragment.empty;
}

function convert(node: PMNode, type: NodeType, schema: Schema): PMNode {
  return type.create(null, type.spec.marks === "" ? plain(node, schema) : node.content);
}

/** 항목을 목록 밖으로 꺼내 문단(또는 다른 글 블록)으로 만든다. 목록은 그 자리에서 둘로 갈린다. */
export function liftItem(typeName = "paragraph"): Command {
  return (state, dispatch) => {
    const c = inItem(state);
    if (!c) return false;
    const type = state.schema.nodes[typeName];
    const items: PMNode[] = [];
    c.list.forEach((n) => items.push(n));
    const before = items.slice(0, c.index);
    const after = items.slice(c.index + 1);
    const block = convert(c.item, type, state.schema);
    const nodes = [
      ...(before.length ? [c.list.type.create(null, before)] : []),
      block,
      ...(after.length ? [c.list.type.create(null, after.map((n, i) => (i === 0 ? n.type.create({ level: 0 }, n.content) : n)))] : []),
    ];
    if (dispatch) {
      const tr = state.tr.replaceWith(c.listPos, c.listPos + c.list.nodeSize, nodes);
      const at = c.listPos + (before.length ? nodes[0].nodeSize : 0) + 1 + Math.min(c.offset, block.content.size);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at)).scrollIntoView());
    }
    return true;
  };
}

/** 항목 단계 올리기·내리기(Tab / Shift-Tab). 앞 항목보다 한 단계까지만 깊어진다. */
export function shiftItem(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const c = inItem(state);
    if (!c) return false;
    const { from, to } = state.selection;
    if (dispatch) {
      const tr = state.tr;
      let pos = c.listPos + 1;
      let prev = -1;
      c.list.forEach((item) => {
        let level = item.attrs.level as number;
        if (pos + item.nodeSize > from && pos < to + 1) {
          level = Math.max(0, Math.min(MAX_LEVEL, level + delta, prev + 1));
          if (level !== item.attrs.level) tr.setNodeMarkup(pos, undefined, { ...item.attrs, level });
        }
        prev = level;
        pos += item.nodeSize;
      });
      if (tr.docChanged) dispatch(tr);
    }
    return true; // 목록 안에서는 Tab 이 편집기 밖으로 나가지 않게 한다
  };
}

/** Enter — 항목을 나눈다. 빈 항목이면 단계를 내리고, 맨 바깥 단계면 목록 밖으로 나간다. */
export const splitItem: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection;
  if ($from.parent.type.name !== "mdItem" || !$from.sameParent($to)) return false;
  const item = $from.parent;
  if (item.content.size === 0) {
    return item.attrs.level > 0 ? shiftItem(-1)(state, dispatch) : liftItem()(state, dispatch);
  }
  if (dispatch) {
    const tr = state.tr;
    if (!empty) tr.deleteSelection();
    tr.split(tr.mapping.map($from.pos), 1, [{ type: item.type, attrs: { level: item.attrs.level } }]);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** 항목 맨 앞에서 Backspace — 단계를 내리고, 첫 항목이면 문단으로 꺼낸다. 그 밖에는 기본 동작(앞 항목과 합치기). */
export const backspaceItem: Command = (state, dispatch) => {
  const c = inItem(state);
  if (!c || !state.selection.empty || c.offset !== 0) return false;
  if (c.item.attrs.level > 0) return shiftItem(-1)(state, dispatch);
  return c.index === 0 ? liftItem()(state, dispatch) : false;
};

// ───────────── 블록 종류 ─────────────

type Piece = { item: boolean; node: PMNode };

/** 지금 커서가 있는 블록의 종류(도구 막대 표시용). 표·그림 안이면 null. */
export function blockKind(state: EditorState): BlockKind | null {
  const { $from } = state.selection;
  if ($from.depth === 0) return null;
  const top = $from.node(1);
  if (top.type.name === "mdList") return "list";
  return TEXTBLOCKS.includes(top.type.name) ? (top.type.name as BlockKind) : null;
}

/**
 * 고른 블록들의 종류를 바꾼다(문단 ↔ 큰 제목 ↔ 작은 제목 ↔ 비고 ↔ 목록).
 * 이미 그 종류면 문단으로 되돌린다. 표·그림은 건드리지 않는다.
 */
export function setBlockKind(kind: BlockKind): Command {
  return (state, dispatch) => {
    const { $from, $to, from, to } = state.selection;
    if ($from.depth === 0 || $to.depth === 0) return false;
    const { doc, schema } = state;
    const i0 = $from.index(0);
    const i1 = $to.index(0);
    if (kind === "docTitle" && (i0 !== 0 || i1 !== 0)) return false;

    // 고른 범위의 최상위 노드를 조각(글 블록 · 항목 · 그대로 둘 것)으로 편다
    const units: { piece: Piece; selected: boolean; start: number }[] = [];
    let pos = $from.before(1);
    const startPos = pos;
    for (let i = i0; i <= i1; i++) {
      const node = doc.child(i);
      if (node.type.name === "mdList") {
        let p = pos + 1;
        node.forEach((item) => {
          units.push({ piece: { item: true, node: item }, selected: p + item.nodeSize > from && p < to + 1, start: p });
          p += item.nodeSize;
        });
      } else {
        units.push({ piece: { item: false, node }, selected: TEXTBLOCKS.includes(node.type.name), start: pos });
      }
      pos += node.nodeSize;
    }
    const endPos = pos;
    const picked = units.filter((u) => u.selected);
    if (!picked.length) return false;

    const already = picked.every((u) => (kind === "list" ? u.piece.item : !u.piece.item && u.piece.node.type.name === kind));
    const target: BlockKind = already ? "paragraph" : kind;
    const itemType = schema.nodes.mdItem;
    const pieces: Piece[] = units.map((u) => {
      if (!u.selected) return u.piece;
      if (target === "list") {
        return u.piece.item ? u.piece : { item: true, node: itemType.create({ level: 0 }, u.piece.node.content) };
      }
      return { item: false, node: convert(u.piece.node, schema.nodes[target], schema) };
    });

    // 이어진 항목끼리 목록 하나로 다시 묶는다
    const nodes: PMNode[] = [];
    const starts: number[] = []; // 조각마다 새 문서에서의 글자 시작 자리
    let run: PMNode[] = [];
    let cursor = startPos;
    const closeRun = () => {
      if (!run.length) return;
      const list = schema.nodes.mdList.create(null, run);
      nodes.push(list);
      cursor += list.nodeSize;
      run = [];
    };
    for (const p of pieces) {
      if (p.item) {
        if (!run.length) cursor += 0;
        starts.push(cursor + 1 + run.reduce((n, x) => n + x.nodeSize, 0) + 1);
        run.push(run.length ? p.node : p.node.type.create({ ...p.node.attrs, level: 0 }, p.node.content));
      } else {
        closeRun();
        starts.push(cursor + 1);
        nodes.push(p.node);
        cursor += p.node.nodeSize;
      }
    }
    closeRun();

    let tr: Transaction;
    try {
      tr = state.tr.replaceWith(startPos, endPos, nodes);
      tr.doc.check();
    } catch {
      return false; // 그 자리에 둘 수 없는 종류(예: 맨 앞이 아닌 문서 제목)
    }
    if (dispatch) {
      const locate = (at: number, bias: 1 | -1) => {
        const u = units.findIndex((x) => at >= x.start && at <= x.start + x.piece.node.nodeSize);
        if (u < 0) return tr.mapping.map(at, bias);
        const offset = Math.max(0, at - units[u].start - 1);
        return starts[u] + Math.min(offset, pieces[u].node.content.size);
      };
      const a = locate(from, -1);
      const b = to === from ? a : locate(to, 1);
      try {
        tr.setSelection(TextSelection.create(tr.doc, Math.min(a, b), Math.max(a, b)));
      } catch {
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(startPos + 1, tr.doc.content.size))));
      }
      joinLists(tr);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** 맞닿은 목록을 하나로 합친다(MD 로 쓰면 어차피 한 목록으로 읽힌다). */
export function joinLists(tr: Transaction): void {
  for (;;) {
    let at = -1;
    let pos = 0;
    for (let i = 0; i < tr.doc.childCount; i++) {
      const node = tr.doc.child(i);
      if (i > 0 && node.type.name === "mdList" && tr.doc.child(i - 1).type.name === "mdList") {
        at = pos;
        break;
      }
      pos += node.nodeSize;
    }
    if (at < 0) return;
    tr.join(at);
  }
}
