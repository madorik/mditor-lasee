// 문서(JSON) ↔ 편집기(ProseMirror JSON).
//
// 화면에는 MD 파서가 없다 — 서버가 되읽은 문서를 받아 연다(toPM). 화면에 있는 것은 직렬화(fromPM)뿐이고,
// 그 출력은 서버 doc_md 와 **바이트 단위로 같아야** 한다(convert.test.ts 가 공유 기준 파일로 확인한다).

import type { JSONContent } from "@tiptap/core";
import { cellShade, normalize, segments, SPACES, tag, write, type Ctx, type Dialect, type Seg } from "../inline";
import { spans } from "../table";
import type { Align, Doc, TableBlock } from "../types";

const DELIM: Record<string, string> = { null: "---", left: ":---", center: ":---:", right: "---:" };

// ───────────── 문서 → 편집기 ─────────────

function marksOf(s: Seg): JSONContent["marks"] {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (s.bold) marks.push({ type: "bold" });
  if (s.strike) marks.push({ type: "strike" });
  if (s.underline) marks.push({ type: "underline" });
  if (s.shade) marks.push({ type: "mdShade" });
  if (s.color) marks.push({ type: "mdColor", attrs: { name: s.color } });
  return marks.length ? marks : undefined;
}

export function inlineToPM(s: string): JSONContent[] {
  const out: JSONContent[] = [];
  for (const sg of segments(s)) {
    const marks = marksOf(sg);
    sg.text.split("\n").forEach((line, i) => {
      if (i) out.push(marks ? { type: "hardBreak", marks } : { type: "hardBreak" });
      if (line) out.push(marks ? { type: "text", text: line, marks } : { type: "text", text: line });
    });
  }
  return out;
}

const plainText = (s: string): JSONContent[] => (s ? [{ type: "text", text: s }] : []);

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
          node(head ? "tableHeader" : "tableCell", [node("paragraph", inlineToPM(inner))], {
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

export function toPM(doc: Doc): JSONContent {
  const content: JSONContent[] = [];
  if (doc.title) content.push(node("docTitle", plainText(doc.title)));
  const body = content.length;
  doc.sections.forEach((s, i) => {
    if (s.title || i > 0) content.push(node("sectionHead", plainText(s.title)));
    for (const b of s.blocks) {
      if (b.title) content.push(node("blockTitle", plainText(b.title)));
      if (b.kind === "text") {
        if (b.text) content.push(node("paragraph", inlineToPM(b.text)));
      } else if (b.kind === "list") {
        content.push(node("mdList", b.items.map((it) => node("mdItem", inlineToPM(it.text), { level: it.level }))));
      } else if (b.kind === "table") {
        content.push(tableToPM(b));
      } else {
        content.push(node("mdImage", [], { src: b.src, caption: b.caption }));
      }
      for (const n of b.notes) content.push(node("mdNote", inlineToPM(n)));
    }
  });
  if (content.length === body) content.push({ type: "paragraph" }); // 본문이 하나는 있어야 한다
  return { type: "doc", content };
}

// ───────────── 편집기 → MD ─────────────

function segsOf(content: JSONContent[] | undefined): Seg[] {
  const out: Seg[] = [];
  for (const n of content ?? []) {
    const s: Seg = { text: n.type === "hardBreak" ? "\n" : (n.text ?? "") };
    for (const m of n.marks ?? []) {
      if (m.type === "bold") s.bold = true;
      else if (m.type === "strike") s.strike = true;
      else if (m.type === "underline") s.underline = true;
      else if (m.type === "mdShade") s.shade = true;
      else if (m.type === "mdColor") s.color = String(m.attrs?.name ?? "빨강");
    }
    out.push(s);
  }
  return out;
}

export function inlineToMd(content: JSONContent[] | undefined, ctx: Ctx = null, dialect: Dialect = "ko"): string {
  return write(normalize(segsOf(content)), ctx, dialect);
}

const oneLine = (content: JSONContent[] | undefined): string =>
  (content ?? [])
    .map((n) => n.text ?? " ")
    .join("")
    .replace(SPACES, " ")
    .trim();

/** 표 노드 → MD 줄들. 합친 칸은 점유 격자를 만들고, 숨은 칸이 기준 칸과 같은 행이면 `<`, 아니면 `^`. */
export function tableMd(t: JSONContent, dialect: Dialect = "ko"): string[] {
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
      const segs: Seg[] = [];
      (cell.content ?? []).forEach((p, i) => {
        if (i) segs.push({ text: "\n" });
        segs.push(...segsOf(p.content));
      });
      const text = write(normalize(segs), "cell", dialect);
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
  const line = (g: (string | undefined)[]) =>
    "| " + Array.from({ length: width }, (_, c) => (g[c] ?? "").replaceAll("|", "\\|")).join(" | ") + " |";
  const kept = (t.attrs?.align ?? []) as Align[];
  const delim = Array.from({ length: width }, (_, c) => {
    const seen = aligns[c];
    if (!seen?.length) return DELIM[String(kept[c] ?? null)];
    const count = new Map<Align, number>();
    seen.forEach((a) => count.set(a, (count.get(a) ?? 0) + 1));
    let best: Align = seen[0]; // 가장 많은 정렬. 같으면 먼저 나온 것
    for (const [a, n] of count) if (n > (count.get(best) ?? 0)) best = a;
    return DELIM[String(best)];
  });
  return [...grid.slice(0, heads).map(line), "|" + delim.map((d) => `${d}|`).join(""), ...grid.slice(heads).map(line)];
}

type Draft = { title: string | null; kind: string | null; lines: string[]; notes: string[]; levels: number[] };

/**
 * 편집기 문서 → MD. 서버 parse_blocks 와 같은 규칙으로 블록을 묶는다:
 * 제목이 새 블록을 연다. 문단·목록·표·그림은 아직 본문이 없을 때만 지금 블록에 붙고(목록 항목은 같은 목록에 이어 붙는다),
 * 비고는 지금 블록에 붙는다. 빈 문단·빈 항목은 버린다.
 */
export function fromPM(doc: JSONContent, dialect: Dialect = "ko"): string {
  let title = "";
  const sections: { title: string; blocks: string[] }[] = [];
  let secTitle = "";
  let blocks: string[] = [];
  let cur: Draft | null = null;

  const flush = () => {
    if (cur) {
      const lines: string[] = [];
      if (cur.title) lines.push(`### ${cur.title}`);
      lines.push(...cur.lines, ...cur.notes.map((n) => `> ${n}`));
      if (lines.length) blocks.push(lines.join("\n"));
    }
    cur = null;
  };
  const closeSection = () => {
    flush();
    if (secTitle || blocks.length || sections.length) sections.push({ title: secTitle, blocks });
    blocks = [];
  };
  const body = (kind: string): Draft => {
    if (!cur || cur.kind !== null || cur.notes.length) {
      flush();
      cur = { title: null, kind: null, lines: [], notes: [], levels: [] };
    }
    cur.kind = kind;
    return cur;
  };

  (doc.content ?? []).forEach((n, i) => {
    if (n.type === "docTitle") {
      if (i === 0) title = oneLine(n.content);
    } else if (n.type === "sectionHead") {
      closeSection();
      secTitle = oneLine(n.content);
    } else if (n.type === "blockTitle") {
      flush();
      cur = { title: oneLine(n.content) || null, kind: null, lines: [], notes: [], levels: [] };
    } else if (n.type === "paragraph") {
      const text = inlineToMd(n.content, "para", dialect);
      if (text) body("text").lines.push(text);
    } else if (n.type === "mdList") {
      for (const it of n.content ?? []) {
        const text = inlineToMd(it.content, "item", dialect);
        if (!text) continue;
        const open: Draft | null = cur;
        const b: Draft = open && open.kind === "list" && !open.notes.length ? open : body("list");
        const want = Math.min(3, Math.max(0, Number(it.attrs?.level ?? 0)));
        const level = b.levels.length ? Math.min(want, b.levels[b.levels.length - 1] + 1) : 0;
        b.levels.push(level);
        b.lines.push(`${"  ".repeat(level)}- ${text}`);
      }
    } else if (n.type === "table") {
      body("table").lines.push(...tableMd(n, dialect));
    } else if (n.type === "mdImage") {
      const caption = String(n.attrs?.caption ?? "").replace(SPACES, " ").trim();
      body("image").lines.push(`![${caption}](${String(n.attrs?.src ?? "").trim()})`);
    } else if (n.type === "mdNote") {
      const text = inlineToMd(n.content, null, dialect);
      if (text) {
        cur ??= { title: null, kind: null, lines: [], notes: [], levels: [] };
        (cur as Draft).notes.push(text);
      }
    }
  });
  closeSection();

  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  sections.forEach((s, i) => {
    const sub = s.title || i > 0 ? [`## ${s.title}`.trimEnd(), ...s.blocks] : s.blocks;
    if (sub.length) parts.push(sub.join("\n\n"));
  });
  const out = parts.filter(Boolean).join("\n\n");
  return out ? out + "\n" : "";
}
