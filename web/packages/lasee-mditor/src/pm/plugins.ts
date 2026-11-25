// 편집기 플러그인 — 번호 목록의 번호, 찾아 바꾸기, 쪽 경계.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, tableEditingKey, TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { headRows } from "./commands";
import { jsonOf, pmToDoc, type DocTrace } from "./convert";

// ───────────── 번호 목록 ─────────────

/**
 * 번호 항목마다 번호를 단다(data-num). MD 로 쓸 때와 같은 규칙 — 맞닿은 목록은 한 목록이고,
 * 같은 단계의 번호 항목이 이어지는 동안 1(또는 첫 항목의 start)부터 센다. 더 얕은 항목이나 글머리 항목이 끼면 다시 센다.
 */
export function listNumbers(doc: PMNode): Map<number, number> {
  const out = new Map<number, number>();
  let nums: (number | null)[] = [];
  let prev = -1; // 바로 앞 항목의 단계(-1: 목록 밖)
  doc.forEach((node, offset) => {
    if (node.type.name !== "mdList") {
      nums = [];
      prev = -1;
      return;
    }
    let pos = offset + 1;
    node.forEach((item) => {
      const at = pos;
      pos += item.nodeSize;
      if (!/\S/.test(item.textContent)) return; // 빈 항목은 MD 에 쓰지 않으므로 세지 않는다
      const want = Math.max(0, Number(item.attrs.level) || 0);
      const level = prev < 0 ? 0 : Math.min(want, prev + 1);
      nums = nums.slice(0, level + 1);
      while (nums.length < level + 1) nums.push(null);
      if (item.attrs.ordered) {
        const last = nums[level];
        const n = last !== null ? last + 1 : Number(item.attrs.start ?? 1);
        nums[level] = n;
        out.set(at, n);
      } else nums[level] = null;
      prev = level;
    });
  });
  return out;
}

const numbersKey = new PluginKey<DecorationSet>("mdListNumbers");

export const ListNumbers = Extension.create({
  name: "mdListNumbers",
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      for (const [pos, n] of listNumbers(doc)) {
        const node = doc.nodeAt(pos);
        if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-num": String(n) }));
      }
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: numbersKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: { decorations: (state) => numbersKey.getState(state) },
      }),
    ];
  },
});

// ───────────── 찾아 바꾸기 ─────────────

export type FindState = { query: string; caseSensitive: boolean; matches: { from: number; to: number }[]; index: number };

export const findKey = new PluginKey<FindState>("mdFind");

type FindMeta = { query?: string; caseSensitive?: boolean; index?: number };

function search(doc: PMNode, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const needle = caseSensitive ? query : query.toLowerCase();
  // 글 블록마다 글자를 이어 붙여 찾는다(서식이 바뀌는 자리를 넘어서도 찾도록)
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(-1);
        text += "\u0000";
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let at = hay.indexOf(needle);
    while (at >= 0) {
      const from = map[at];
      const to = map[at + needle.length - 1];
      if (from >= 0 && to >= 0) out.push({ from, to: to + 1 });
      at = hay.indexOf(needle, at + Math.max(1, needle.length));
    }
    return false;
  });
  return out;
}

function nearest(matches: { from: number }[], pos: number): number {
  const i = matches.findIndex((m) => m.from >= pos);
  return i < 0 ? 0 : i;
}

export const FindReplace = Extension.create({
  name: "mdFind",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", caseSensitive: false, matches: [], index: 0 }),
          apply: (tr, old, _o, state) => {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            if (!meta && !tr.docChanged) return old;
            const query = meta?.query ?? old.query;
            const caseSensitive = meta?.caseSensitive ?? old.caseSensitive;
            const matches = search(state.doc, query, caseSensitive);
            let index = meta?.index ?? (meta?.query !== undefined ? nearest(matches, state.selection.from) : old.index);
            if (matches.length) index = ((index % matches.length) + matches.length) % matches.length;
            else index = 0;
            return { query, caseSensitive, matches, index };
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "mde-find-hit current" : "mde-find-hit" })),
            );
          },
        },
      }),
    ];
  },
});

/** 찾을 글 · 대소문자 구분을 바꾼다. */
export function setFind(state: EditorState, meta: FindMeta): Transaction {
  return state.tr.setMeta(findKey, meta).setMeta("addToHistory", false);
}

/** 다음(1) · 이전(-1) 찾은 자리로 옮기고 골라 둔다. */
export function stepFind(state: EditorState, dir: 1 | -1): Transaction | null {
  const s = findKey.getState(state);
  if (!s?.matches.length) return null;
  const index = (s.index + dir + s.matches.length) % s.matches.length;
  const m = s.matches[index];
  return state.tr.setMeta(findKey, { index }).setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView();
}

/** 지금 찾은 자리 하나를 바꾼다. */
export function replaceOne(state: EditorState, text: string): Transaction | null {
  const s = findKey.getState(state);
  const m = s?.matches[s.index];
  if (!m) return null;
  const marks = state.doc.resolve(m.from).marksAcross(state.doc.resolve(m.to)) ?? [];
  const tr = state.tr;
  if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
  else tr.delete(m.from, m.to);
  return tr.setMeta(findKey, { index: s!.index }).scrollIntoView();
}

/** 찾은 자리를 모두 바꾼다(뒤에서부터 — 앞자리가 밀리지 않게). */
export function replaceAll(state: EditorState, text: string): Transaction | null {
  const s = findKey.getState(state);
  if (!s?.matches.length) return null;
  const tr = state.tr;
  for (const m of [...s.matches].reverse()) {
    const marks = state.doc.resolve(m.from).marksAcross(state.doc.resolve(m.to)) ?? [];
    if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
    else tr.delete(m.from, m.to);
  }
  return tr.setMeta(findKey, { index: 0 });
}

// ───────────── 쪽 경계 ─────────────

/**
 * 쪽 경계 — 쓰는 쪽이 계산해 넘긴다(MDitor 서버는 PDF 를 실제로 그려 본 쪽 배치로 만든다). 편집기는 쪽을 짐작하지 않는다.
 * 자리는 문서(JSON)의 순번으로 적는다: sections 는 섹션 순번 → 그 머리에서 시작하는 쪽,
 * blocks 는 블록 순번(문서 전체) → 블록 앞(before) · 목록 항목 앞(items, 항목 순번) · 표 본문 행 앞(rows, 본문 행 순번)에서 시작하는 쪽.
 */
export type PageMarks = {
  total: number;
  sections?: Record<number, number>;
  blocks?: Record<number, { before?: number | null; items?: Record<number, number>; rows?: Record<number, number> }>;
};

export type PagePlace = { pos: number; page: number; kind: "block" | "item" | "row"; width: number };

/** 쪽 경계 → 편집기 문서의 자리(그 노드 바로 앞). */
export function pageMarkPlaces(doc: PMNode, marks: PageMarks): PagePlace[] {
  const trace: DocTrace = { sections: [], blocks: [] };
  pmToDoc(jsonOf(doc), "ko", trace);
  const offsets: number[] = [];
  doc.forEach((_, off) => offsets.push(off));
  const childPos = (parent: number, index: number) => {
    const node = doc.child(parent);
    let pos = offsets[parent] + 1;
    for (let k = 0; k < index && k < node.childCount; k++) pos += node.child(k).nodeSize;
    return pos;
  };
  const out: PagePlace[] = [];
  for (const [s, page] of Object.entries(marks.sections ?? {})) {
    const node = trace.sections[Number(s)];
    if (node !== undefined && node >= 0) out.push({ pos: offsets[node], page, kind: "block", width: 1 });
  }
  for (const [b, m] of Object.entries(marks.blocks ?? {})) {
    const t = trace.blocks[Number(b)];
    if (!t) continue;
    if (m.before) out.push({ pos: offsets[t.node], page: m.before, kind: "block", width: 1 });
    for (const [k, page] of Object.entries(m.items ?? {})) {
      const it = t.items[Number(k)];
      if (it) out.push({ pos: childPos(it[0], it[1]), page, kind: "item", width: 1 });
    }
    if (t.table >= 0 && m.rows) {
      const table = doc.child(t.table);
      const heads = headRows(table);
      const width = TableMap.get(table).width;
      for (const [r, page] of Object.entries(m.rows)) {
        const row = heads + Number(r);
        if (row < table.childCount) out.push({ pos: childPos(t.table, row), page, kind: "row", width });
      }
    }
  }
  return out.sort((a, b) => a.pos - b.pos || a.page - b.page);
}

type MarksState = { marks: PageMarks | null; visible: boolean; deco: DecorationSet };
type MarksMeta = { marks?: PageMarks | null; visible?: boolean };

export const pageMarksKey = new PluginKey<MarksState>("mdPageMarks");

function markDom(p: PagePlace, label: (n: number) => string): HTMLElement {
  const line = document.createElement("div");
  line.className = "mde-pagemark";
  line.setAttribute("role", "separator");
  line.setAttribute("aria-label", label(p.page));
  line.dataset.page = String(p.page);
  const tag = document.createElement("span");
  tag.textContent = label(p.page);
  line.append(tag);
  if (p.kind !== "row") return line;
  const tr = document.createElement("tr");
  tr.className = "mde-pagemark-row";
  const td = document.createElement("td");
  td.colSpan = p.width;
  td.append(line);
  tr.append(td);
  return tr;
}

/**
 * 쪽 경계 플러그인. setPageMarks 로 경계를 받으면 그 자리에 'n쪽' 줄을 그리고,
 * 새 경계가 오기 전까지는 글을 고쳐도 경계가 글을 따라 움직인다.
 */
export const PageMarksExtension = Extension.create<{ label: (n: number) => string }>({
  name: "mdPageMarks",
  addOptions() {
    return { label: (n: number) => String(n) };
  },
  addProseMirrorPlugins() {
    const label = this.options.label;
    const build = (doc: PMNode, st: MarksState) =>
      st.visible && st.marks
        ? DecorationSet.create(
            doc,
            pageMarkPlaces(doc, st.marks).map((p) => Decoration.widget(p.pos, () => markDom(p, label), { side: -1, ignoreSelection: true, key: `page-${p.kind}-${p.page}-${p.width}` })),
          )
        : DecorationSet.empty;
    return [
      new Plugin<MarksState>({
        key: pageMarksKey,
        state: {
          init: () => ({ marks: null, visible: false, deco: DecorationSet.empty }),
          apply: (tr, old, _o, state) => {
            const meta = tr.getMeta(pageMarksKey) as MarksMeta | undefined;
            if (meta) {
              const next = { ...old, ...meta };
              return { ...next, deco: build(state.doc, next) };
            }
            return tr.docChanged ? { ...old, deco: old.deco.map(tr.mapping, tr.doc) } : old;
          },
        },
        props: { decorations: (state) => pageMarksKey.getState(state)?.deco },
      }),
    ];
  },
});

/** 쪽 경계를 바꾸거나 켜고 끈다. */
export function setPageMarksMeta(state: EditorState, meta: MarksMeta): Transaction {
  return state.tr.setMeta(pageMarksKey, meta).setMeta("addToHistory", false);
}

// ───────────── 칸 고르기 지키기 ─────────────

/**
 * 칸을 끌어 고른 직후의 고른 칸을 지킨다.
 * 끌기를 마치면(mouseup) 브라우저가 가끔 놓은 자리의 커서로 selectionchange 를 한 번 더 보내고, 편집기는 그것을
 * 마우스로 놓은 커서("pointer")로 읽어 고른 칸이 풀렸다(빨리 '칸 합치기' 를 누르면 듣지 않았다).
 * 끌기가 끝난 뒤 짧은 동안, 새로 누르지 않았는데 들어온 그런 커서는 받지 않는다.
 */
export const CellSelectionGuard = Extension.create({
  name: "mdCellSelectionGuard",
  addProseMirrorPlugins() {
    let dragEnd = 0; // 칸 끌기를 마친 때(0: 지킬 것이 없다)
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: () => {
              dragEnd = 0; // 새로 눌렀다 — 그 뒤의 커서는 사람이 놓은 것이다
              return false;
            },
          },
        },
        filterTransaction: (tr, state) => {
          if (!(state.selection instanceof CellSelection)) return true;
          if (tr.getMeta(tableEditingKey) === -1) {
            dragEnd = Date.now();
            return true;
          }
          if (!dragEnd || tr.docChanged) return true;
          if (Date.now() - dragEnd > 300) {
            dragEnd = 0;
            return true;
          }
          return !(tr.getMeta("pointer") && tr.selection.empty);
        },
      }),
    ];
  },
});
