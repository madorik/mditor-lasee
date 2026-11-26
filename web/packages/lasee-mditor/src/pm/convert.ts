// 문서(JSON) ↔ 편집기(ProseMirror JSON), 편집기 → MD.
//
// 편집기 → MD 는 편집기 문서를 문서(JSON)로 묶은 뒤(pmToDoc) MD 로 쓴다(docToMarkdown).
// 그 출력은 서버 doc_md 와 **바이트 단위로 같아야** 한다(convert.test.ts 가 공유 기준 파일로 확인한다).

import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cellShade, normalize, oneSpace, pyStrip, segments, SPACES, tag, write, type Ctx, type Dialect, type Seg, type TextAlign } from "../core/inline";
import { finishItems, oneLine } from "../core/parse";
import { spans } from "../core/table";
import type { Align, Block, BlockBody, Doc, Section, TableBlock } from "../core/types";
import { docToMarkdown } from "../core/write";

// ───────────── 문서 → 편집기 ─────────────

function marksOf(s: Seg): JSONContent["marks"] {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (s.link) marks.push({ type: "link", attrs: { href: s.link } });
  if (s.bold) marks.push({ type: "bold" });
  if (s.strike) marks.push({ type: "strike" });
  if (s.italic) marks.push({ type: "italic" });
  if (s.underline) marks.push({ type: "underline" });
  if (s.shade) marks.push({ type: "mdShade" });
  if (s.mark) marks.push({ type: "mdHighlight" });
  if (s.color) marks.push({ type: "mdColor", attrs: { name: s.color } });
  if (s.script === "sup") marks.push({ type: "superscript" });
  if (s.script === "sub") marks.push({ type: "subscript" });
  if (s.code) marks.push({ type: "code" });
  return marks.length ? marks : undefined;
}

export function inlineToPM(s: string): JSONContent[] {
  return segsToPM(segments(s));
}

function segsToPM(segs: Seg[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const sg of segs) {
    const marks = marksOf(sg);
    sg.text.split("\n").forEach((line, i) => {
      if (i) out.push(marks ? { type: "hardBreak", marks } : { type: "hardBreak" });
      if (line) out.push(marks ? { type: "text", text: line, marks } : { type: "text", text: line });
    });
  }
  return out;
}

function node(type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent {
  const out: JSONContent = { type };
  if (attrs) out.attrs = attrs;
  if (content.length) out.content = content;
  return out;
}

function tableToPM(b: TableBlock): JSONContent {
  const rows: JSONContent[] = [];
  for (const [grid, head] of [[b.head, true], [b.rows, false]] as const) {
    const sp = spans(grid);
    grid.forEach((row, r) => {
      const cells: JSONContent[] = [];
      row.forEach((raw, c) => {
        if (sp[r][c].hidden) return;
        const [shade, inner] = cellShade(raw);
        cells.push(
          node(head ? "tableHeader" : "tableCell", cellToPM(inner), {
            colspan: sp[r][c].colSpan,
            rowspan: sp[r][c].rowSpan,
            shade,
            align: b.align[c] ?? null,
          }),
        );
      });
      rows.push(node("tableRow", cells));
    });
  }
  return node("table", rows, { align: b.align });
}

/** 칸 글 → 칸 안의 문단 · 그림(그림은 칸 안에서 한 줄을 차지한다). 칸에는 무엇이든 하나는 있어야 한다. */
function cellToPM(inner: string): JSONContent[] {
  const segs = segments(inner, true);
  if (!segs.some((sg) => sg.image !== undefined)) return [node("paragraph", segsToPM(segs))];
  const out: JSONContent[] = [];
  let run: Seg[] = [];
  const flush = () => {
    if (run.some((sg) => sg.text)) out.push(node("paragraph", segsToPM(run)));
    run = [];
  };
  for (const sg of segs) {
    if (sg.image === undefined) {
      run.push(sg);
      continue;
    }
    flush();
    out.push(node("mdImage", [], { src: sg.image, caption: sg.text, width: sg.width ?? null }));
  }
  flush();
  return out.length ? out : [node("paragraph", [])];
}

function bodyToPM(b: Block): JSONContent | null {
  switch (b.kind) {
    case "text":
      return b.text ? node("paragraph", inlineToPM(b.text), b.align ? { align: b.align } : undefined) : null;
    case "list":
      return node(
        "mdList",
        b.items.map((it) => node("mdItem", inlineToPM(it.text), { level: it.level, ordered: !!it.ordered, start: it.start ?? null, checked: it.checked ?? null })),
      );
    case "table":
      return tableToPM(b);
    case "image":
      return node("mdImage", [], { src: b.src, caption: b.caption, width: b.width ?? null });
    case "code":
      return node("codeBlock", b.code ? [{ type: "text", text: b.code }] : [], { language: b.lang || null });
    case "rule":
      return { type: "horizontalRule" };
    case "pagebreak":
      return { type: "pageBreak" };
  }
}

export function toPM(doc: Doc): JSONContent {
  const content: JSONContent[] = [];
  if (doc.title) content.push(node("docTitle", inlineToPM(doc.title)));
  const body = content.length;
  doc.sections.forEach((s, i) => {
    if (s.title || i > 0) content.push(node("sectionHead", inlineToPM(s.title)));
    for (const b of s.blocks) {
      if (b.title) content.push(node("blockTitle", inlineToPM(b.title)));
      const n = bodyToPM(b);
      if (n) content.push(n);
      for (const note of b.notes) content.push(node("mdNote", inlineToPM(note)));
    }
  });
  if (content.length === body) content.push({ type: "paragraph" }); // 본문이 하나는 있어야 한다
  return { type: "doc", content };
}

/** 그림 폭(%) — 1~100 의 정수만, 아니면 null(원래 크기). */
export function imageWidth(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/%$/, "")) : Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

// ───────────── 편집기 → 문서 → MD ─────────────

// 고치지 않은 블록은 다시 변환하지 않는다. ProseMirror 는 고치지 않은 노드를 다음 판에서도 같은 객체로 쓴다 —
// 노드마다 JSON 을 기억하면(jsonOf) 고치지 않은 문단 · 항목 · 표 칸은 같은 JSON 객체가 되고, 그 객체에 묶어 둔
// 서식 변환 결과를 그대로 쓴다. 큰 문서에서 글자 하나 칠 때 문서 전체를 다시 변환하던 것을 바뀐 블록만으로 줄인다.
// 기억은 jsonOf 가 만든 객체에만 묶는다 — 쓰는 쪽이 넘긴 JSON 은 나중에 고칠 수 있으므로 기억하지 않는다.
const jsonCache = new WeakMap<PMNode, JSONContent>();
const fromEditor = new WeakSet<object>();
const memo = new WeakMap<object, Map<string, unknown>>();

/** 편집기 노드 → JSON(node.toJSON() 과 같은 꼴). 같은 노드면 같은 객체다 — 돌려받은 JSON 은 고치지 않는다. */
export function jsonOf(node: PMNode): JSONContent {
  const hit = jsonCache.get(node);
  if (hit) return hit;
  let j: JSONContent;
  if (node.isTextblock || node.isLeaf) {
    j = node.toJSON() as JSONContent;
  } else {
    j = { type: node.type.name };
    for (const _ in node.attrs) {
      j.attrs = node.attrs;
      break;
    }
    if (node.childCount) {
      const content: JSONContent[] = [];
      node.forEach((child) => content.push(jsonOf(child)));
      j.content = content;
    }
    if (node.marks.length) j.marks = node.marks.map((m) => m.toJSON());
  }
  fromEditor.add(j);
  if (j.content) fromEditor.add(j.content);
  jsonCache.set(node, j);
  return j;
}

function remember<T>(key: object | undefined, name: string, make: () => T): T {
  if (!key || !fromEditor.has(key)) return make();
  let m = memo.get(key);
  if (!m) memo.set(key, (m = new Map()));
  if (m.has(name)) return m.get(name) as T;
  const value = make();
  m.set(name, value);
  return value;
}

function segsOf(content: JSONContent[] | undefined): Seg[] {
  const out: Seg[] = [];
  for (const n of content ?? []) {
    const s: Seg = { text: n.type === "hardBreak" ? "\n" : (n.text ?? "") };
    for (const m of n.marks ?? []) {
      if (m.type === "link") {
        const href = pyStrip(String(m.attrs?.href ?? ""));
        if (href) s.link = href;
      } else if (m.type === "bold") s.bold = true;
      else if (m.type === "strike") s.strike = true;
      else if (m.type === "italic") s.italic = true;
      else if (m.type === "underline") s.underline = true;
      else if (m.type === "mdShade") s.shade = true;
      else if (m.type === "mdHighlight") s.mark = true;
      else if (m.type === "mdColor") s.color = String(m.attrs?.name ?? "빨강");
      else if (m.type === "superscript") s.script = "sup";
      else if (m.type === "subscript") s.script ??= "sub";
      else if (m.type === "code") s.code = true;
    }
    out.push(s);
  }
  return out;
}

export function inlineToMd(content: JSONContent[] | undefined, ctx: Ctx = null, dialect: Dialect = "ko"): string {
  return remember(content, `i${ctx}|${dialect}`, () => write(normalize(segsOf(content)), ctx, dialect));
}

/** 제목 노드 → 제목의 표준 꼴(서버 inline.title 과 같다). */
export function titleToMd(content: JSONContent[] | undefined, dialect: Dialect = "ko"): string {
  return remember(content, `t|${dialect}`, () => write(normalize(oneSpace(segsOf(content))), null, dialect));
}

/** 표 노드 → 문서의 표(머리글 · 본문 · 열 정렬). 합친 칸은 점유 격자를 만들고, 숨은 칸이 기준 칸과 같은 행이면 `<`, 아니면 `^`. */
export function tableData(t: JSONContent, dialect: Dialect = "ko"): { head: string[][]; rows: string[][]; align: Align[] } {
  return remember(t, `T|${dialect}`, () => tableDataNow(t, dialect));
}

function tableDataNow(t: JSONContent, dialect: Dialect): { head: string[][]; rows: string[][]; align: Align[] } {
  const shade = tag("음영", dialect);
  const rows = t.content ?? [];
  const grid: (string | undefined)[][] = rows.map(() => []);
  const aligns: Align[][] = []; // 열마다 본문 기준 칸들의 정렬
  const isHead: boolean[] = [];
  rows.forEach((row, r) => {
    const cells = row.content ?? [];
    const prev = r === 0 || isHead[r - 1];
    isHead[r] = r === 0 || (prev && (cells.length ? cells.every((c) => c.type === "tableHeader") : true));
    let c = 0;
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++;
      const cs = Math.max(1, Number(cell.attrs?.colspan ?? 1));
      const rs = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
      const text = remember(cell, `c|${dialect}`, () => {
        const segs: Seg[] = [];
        let prevText = false; // 앞 칸 내용이 문단이었나 — 문단과 문단 사이만 줄바꿈이다(그림은 스스로 한 줄을 차지한다)
        for (const p of cell.content ?? []) {
          if (p.type === "mdImage") {
            const w = imageWidth(p.attrs?.width);
            segs.push(w ? { text: String(p.attrs?.caption ?? ""), image: String(p.attrs?.src ?? ""), width: w } : { text: String(p.attrs?.caption ?? ""), image: String(p.attrs?.src ?? "") });
            prevText = false;
            continue;
          }
          if (prevText) segs.push({ text: "\n" });
          segs.push(...segsOf(p.content));
          prevText = true;
        }
        return write(normalize(segs), "cell", dialect);
      });
      for (let dr = 0; dr < rs && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? (cell.attrs?.shade ? `{${shade}}${text}{/${shade}}` : text) : dr === 0 ? "<" : "^";
        }
      }
      if (!isHead[r] && cs === 1) (aligns[c] ??= []).push((cell.attrs?.align ?? null) as Align);
      c += cs;
    }
  });
  const width = Math.max(1, ...grid.map((g) => g.length));
  const heads = isHead.filter(Boolean).length;
  const full = grid.map((g) => Array.from({ length: width }, (_, c) => g[c] ?? ""));
  const kept = (t.attrs?.align ?? []) as Align[];
  const align = Array.from({ length: width }, (_, c): Align => {
    const seen = aligns[c];
    if (!seen?.length) return kept[c] ?? null;
    const count = new Map<Align, number>();
    seen.forEach((a) => count.set(a, (count.get(a) ?? 0) + 1));
    let best: Align = seen[0]; // 가장 많은 정렬. 같으면 먼저 나온 것
    for (const [a, n] of count) if (n > (count.get(best) ?? 0)) best = a;
    return best;
  });
  return { head: full.slice(0, heads), rows: full.slice(heads), align };
}

/** 표 노드 → MD 줄들. */
export function tableMd(t: JSONContent, dialect: Dialect = "ko"): string[] {
  const data = tableData(t, dialect);
  return docToMarkdown({ title: "", sections: [{ key: "", title: "", blocks: [{ id: "", kind: "table", title: null, notes: [], ...data }] }] }, dialect)
    .trimEnd()
    .split("\n");
}

const CODE_LANG = /[`\s]/g;

type Draft = {
  title: string | null;
  block: BlockBody | null;
  notes: string[];
  items?: Parameters<typeof finishItems>[0];
  at: number; // 블록이 시작하는 최상위 노드 순번
  itemAt: [number, number][]; // 목록 항목마다 [목록 노드 순번, 그 안의 항목 순번]
  tableAt: number; // 표 노드 순번(없으면 -1)
};

/**
 * 편집기 문서의 자리 ↔ 문서(JSON)의 순번. pmToDoc 이 블록을 묶으면서 적는다.
 * sections: 섹션마다 머리(sectionHead) 노드 순번(머리 없는 첫 섹션은 -1),
 * blocks: 블록마다(문서 전체 순번) 시작 노드 · 목록 항목 · 표 노드.
 */
export type DocTrace = { sections: number[]; blocks: { node: number; items: [number, number][]; table: number }[] };

/**
 * 편집기 문서 → 문서(JSON). 서버 parse_blocks 와 같은 규칙으로 블록을 묶는다:
 * 제목이 새 블록을 연다. 본문은 아직 본문이 없을 때만 지금 블록에 붙고(목록 항목은 같은 목록에 이어 붙는다),
 * 비고는 지금 블록에 붙는다. 빈 문단·빈 항목은 버린다.
 */
export function pmToDoc(doc: JSONContent, dialect: Dialect = "ko", trace?: DocTrace): Doc {
  let title = "";
  let at = 0; // 지금 보는 최상위 노드 순번
  let secNode = -1;
  const draft = (title: string | null = null): Draft => ({ title, block: null, notes: [], at, itemAt: [], tableAt: -1 });
  const sections: Section[] = [];
  let secTitle = "";
  let blocks: Block[] = [];
  let cur: Draft | null = null;
  let ids = 0;

  const flush = () => {
    const d = cur as Draft | null;
    if (d) {
      let b: BlockBody | null = d.block;
      if (b?.kind === "list") b = { ...b, items: finishItems(d.items ?? []) };
      if (!b && (d.title || d.notes.length)) b = { kind: "text", title: null, text: "", notes: [] };
      if (b) {
        blocks.push({ ...b, id: `b${++ids}`, title: d.title, notes: d.notes } as Block);
        trace?.blocks.push({ node: d.at, items: d.itemAt, table: d.tableAt });
      }
    }
    cur = null;
  };
  const closeSection = () => {
    flush();
    if (secTitle || blocks.length || sections.length) {
      sections.push({ key: `s${sections.length + 1}`, title: secTitle, blocks });
      trace?.sections.push(secNode);
    }
    blocks = [];
  };
  /** 본문을 받을 블록 — 제목만 있는 블록이면 그것, 아니면 새 블록. */
  const body = (b: BlockBody): Draft => {
    const d = cur as Draft | null;
    if (!d || d.block || d.notes.length) {
      flush();
      cur = draft();
    }
    const next = cur as unknown as Draft;
    next.block = b;
    return next;
  };

  (doc.content ?? []).forEach((n, i) => {
    at = i;
    switch (n.type) {
      case "docTitle":
        if (i === 0) title = titleToMd(n.content, dialect);
        break;
      case "sectionHead":
        closeSection();
        secNode = i;
        secTitle = titleToMd(n.content, dialect);
        break;
      case "blockTitle":
        flush();
        cur = draft(titleToMd(n.content, dialect) || null);
        break;
      case "paragraph": {
        const text = inlineToMd(n.content, "para", dialect);
        const align = n.attrs?.align as TextAlign | null | undefined;
        if (text) body({ kind: "text", title: null, text, notes: [], ...(align ? { align } : {}) });
        break;
      }
      case "mdList":
        (n.content ?? []).forEach((it, k) => {
          const text = inlineToMd(it.content, "item", dialect);
          if (!text) return;
          const open = cur as Draft | null;
          const d: Draft = open && open.block?.kind === "list" && !open.notes.length ? open : body({ kind: "list", title: null, items: [], notes: [] });
          (d.items ??= []).push({
            text,
            level: Math.min(3, Math.max(0, Number(it.attrs?.level ?? 0))),
            ordered: !!it.attrs?.ordered,
            num: it.attrs?.start != null ? Number(it.attrs.start) : 1,
            checked: it.attrs?.checked == null ? null : !!it.attrs.checked,
          });
          d.itemAt.push([i, k]);
        });
        break;
      case "table":
        body({ kind: "table", title: null, notes: [], ...tableData(n, dialect) }).tableAt = i;
        break;
      case "mdImage": {
        const w = imageWidth(n.attrs?.width);
        body({ kind: "image", title: null, notes: [], src: pyStrip(String(n.attrs?.src ?? "")), caption: oneLine(n.attrs?.caption ?? ""), ...(w ? { width: w } : {}) });
        break;
      }
      case "codeBlock": {
        const lines = (n.content ?? []).map((t) => t.text ?? "").join("").split("\n");
        while (lines.length && !pyStrip(lines[lines.length - 1])) lines.pop();
        const lang = pyStrip(String(n.attrs?.language ?? "")).split(SPACES)[0]?.replace(CODE_LANG, "") ?? "";
        body({ kind: "code", title: null, notes: [], lang, code: lines.join("\n") });
        break;
      }
      case "horizontalRule":
        body({ kind: "rule", title: null, notes: [] });
        break;
      case "pageBreak":
        body({ kind: "pagebreak", title: null, notes: [] });
        break;
      case "mdNote": {
        const text = inlineToMd(n.content, null, dialect);
        if (text) {
          cur ??= draft();
          (cur as Draft).notes.push(text);
        }
        break;
      }
    }
  });
  closeSection();
  return { title, sections, dialect };
}

/** 편집기 문서 → MD. */
export function fromPM(doc: JSONContent, dialect: Dialect = "ko"): string {
  return docToMarkdown(pmToDoc(doc, dialect), dialect);
}

