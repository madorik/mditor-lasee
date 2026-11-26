// MD → 문서. 서버 src/mditor/md.py 의 parse 와 **같은 규칙**이다. 고치면 둘 다 고친다
// (공유 기준 파일 fixture.json 이 어긋남을 잡는다).
//
// 묶는 규칙: 제목(###)이 새 블록을 연다. 본문(문단 · 목록 · 표 · 그림 · 코드 · 가로줄 · 쪽 나눔)은 아직 본문이 없을 때만
// 지금 블록에 붙고, 아니면 제목 없는 새 블록을 연다(목록 항목은 같은 목록에 이어 붙는다). 비고(>)는 지금 블록에 붙는다.

import { blockAlign, canon, cellShade, dialectOf, pyStrip, PS, SPACES, tag, title as inlineTitle, type Dialect, type TextAlign } from "./inline";
import { canonical, marker } from "./table";
import { MdError, type Align, type Block, type BlockBody, type Doc, type Item, type Section } from "./types";

export const MAX_LEVEL = 3;
export const MAX_COLS = 40;

const HEAD = new RegExp(`^(#{1,6})(?:${PS}+(.*))?$`, "s");
const LIST_ITEM = new RegExp(`^(${PS}*)(?:([-*+])|([0-9]{1,9})([.)]))${PS}+(.*)$`, "s");
const EMPTY_ITEM = new RegExp(`^${PS}*(?:[-*+]|[0-9]{1,9}[.)])${PS}*$`, "s");
const TASK = new RegExp(`^\\[([ xX])\\](?:${PS}+(.*))?$`, "s");
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const IMAGE = /^!\[(.*)\]\((.*)\)(?:\{width=(100|[1-9][0-9]?)%\})?$/s;
const NOTE = new RegExp(`^>${PS}?(.*)$`, "s");
const DELIM_CELL = /^:?-+:?$/;
const PAGEBREAK = /^<!--[ \t]*pagebreak[ \t]*-->$/i;
const FENCE_OPEN = /^( {0,3})(`{3,})([^`]*)$/s;
const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/;

type Fence = { indent: number; size: number; lang: string };

/** 코드 울타리(```)를 여는 줄이면 {들여쓰기, 백틱 수, 언어}. */
export function openFence(line: string): Fence | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  return { indent: m[1].length, size: m[2].length, lang: pyStrip(m[3]).split(SPACES)[0] ?? "" };
}

function closesFence(line: string, f: Fence): boolean {
  const m = FENCE_CLOSE.exec(line);
  return !!m && m[1].length >= f.size;
}

/** 줄 앞의 빈칸을 n 칸까지 뗀다(울타리를 들여 쓴 만큼). */
function dedent(line: string, n: number): string {
  let k = 0;
  while (k < n && line[k] === " ") k++;
  return line.slice(k);
}

export const oneLine = (s: unknown): string => pyStrip(String(s ?? "")).split(SPACES).filter(Boolean).join(" ");

/** 표 한 줄 → 칸. `\|` 는 칸 안의 글자 `|` 이다(다른 이스케이프는 글 서식 쪽에서 푼다). */
export function splitCells(line: string): string[] {
  let s = pyStrip(line);
  if (s.startsWith("|")) s = s.slice(1);
  const cells: string[] = [];
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      cur += s[i + 1] === "|" ? "|" : ch + s[i + 1];
      i += 2;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  if (pyStrip(cur) || !cells.length) cells.push(cur);
  return cells.map(pyStrip);
}

function alignOf(delim: string): Align {
  const left = delim.startsWith(":");
  const right = delim.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : null;
}

function cell(raw: string, dialect: Dialect): string {
  if (marker(raw)) return raw;
  const [shaded, inner] = cellShade(raw);
  const text = canon(inner, "cell", dialect);
  const shade = tag("음영", dialect);
  return shaded ? `{${shade}}${text}{/${shade}}` : text;
}

function table(rows: [number, string[]][], dialect: Dialect): { head: string[][]; rows: string[][]; align: Align[] } {
  const d = rows.findIndex(([, cells]) => cells.length > 0 && cells.every((c) => DELIM_CELL.test(c)));
  if (d < 0) throw new MdError(rows[0][0], "table-no-delim", {}, "표에 구분선(|---|) 줄이 없습니다. 머리글 줄 바로 아래에 넣으세요.");
  if (d === 0) throw new MdError(rows[0][0], "table-no-head", {}, "구분선(|---|) 위에 머리글 줄이 없습니다.");
  const width = rows[d - 1][1].length;
  if (width > MAX_COLS) throw new MdError(rows[d - 1][0], "table-too-wide", { max: MAX_COLS, width }, `표는 ${MAX_COLS}칸까지 쓸 수 있습니다(지금 ${width}칸).`);
  const grid: string[][] = [];
  for (const [ln, cells] of [...rows.slice(0, d), ...rows.slice(d + 1)]) {
    if (cells.length > width) throw new MdError(ln, "table-row-too-long", { cells: cells.length, width }, `이 줄은 ${cells.length}칸인데 머리글은 ${width}칸입니다.`);
    grid.push([...cells, ...Array(width - cells.length).fill("")].map((c) => cell(c, dialect)));
  }
  const marks = [...rows[d][1], ...Array(width).fill("---")].slice(0, width);
  return { head: canonical(grid.slice(0, d)), rows: canonical(grid.slice(d)), align: marks.map(alignOf) };
}

type RawItem = { text: string; level: number; ordered: boolean; num: number; checked: boolean | null };
type Draft = {
  title?: string | null;
  kind?: Block["kind"];
  text?: string;
  align?: TextAlign | null;
  items?: RawItem[];
  cols?: number[]; // 목록: 열린 항목들의 글 시작 칸(들여쓰기로 단계를 정한다)
  head?: string[][];
  rows?: string[][];
  talign?: Align[];
  src?: string;
  caption?: string;
  width?: number;
  lang?: string;
  code?: string;
  notes?: string[];
};

/** 목록 항목들의 단계를 다듬고(앞 항목보다 한 단계까지만 깊어진다), 번호 구간의 첫 항목에 시작 번호를 단다. */
export function finishItems(raw: RawItem[]): Item[] {
  const items: Item[] = [];
  const ordAt: boolean[] = []; // 단계마다: 같은 부모 아래 바로 앞 항목이 번호 항목인가
  for (const it of raw) {
    const level = items.length ? Math.min(it.level, items[items.length - 1].level + 1) : 0;
    ordAt.length = level + 1;
    const out: Item = { text: it.text, level };
    if (it.ordered) {
      out.ordered = true;
      if (!ordAt[level] && it.num !== 1) out.start = it.num;
    }
    if (it.checked !== null) out.checked = it.checked;
    ordAt[level] = it.ordered;
    items.push(out);
  }
  return items;
}

/** 읽던 블록을 표준 꼴로 닫는다. 내용이 하나도 없으면 null. */
function finish(b: Draft): BlockBody | null {
  const kind = b.kind ?? "text";
  const titleText = b.title || null;
  const notes = b.notes ?? [];
  let out: BlockBody;
  if (kind === "text") {
    const text = b.text ?? "";
    if (!titleText && !text && !notes.length) return null;
    out = { kind, title: titleText, text, notes };
    if (text && b.align) out.align = b.align;
  } else if (kind === "list") {
    out = { kind, title: titleText, items: finishItems(b.items ?? []), notes };
  } else if (kind === "table") {
    out = { kind, title: titleText, head: b.head!, rows: b.rows!, align: b.talign!, notes };
  } else if (kind === "image") {
    out = { kind, title: titleText, src: b.src!, caption: b.caption!, ...(b.width ? { width: b.width } : {}), notes };
  } else if (kind === "code") {
    out = { kind, title: titleText, lang: b.lang ?? "", code: b.code ?? "", notes };
  } else {
    out = { kind, title: titleText, notes };
  }
  return out;
}

/** (줄 번호, 줄) → id 없는 블록 목록. 섹션 머리(##)는 여기 오기 전에 걸러진다. */
export function parseBlocks(lines: [number, string][], dialect: Dialect = "ko"): BlockBody[] {
  const out: BlockBody[] = [];
  let cur: Draft | null = null;

  const flush = () => {
    if (cur) {
      const done = finish(cur);
      if (done) out.push(done);
    }
    cur = null;
  };
  /** 본문을 받을 블록 — 제목만 있는 블록이면 그것, 아니면 새 블록. */
  const body = (kind: Block["kind"]): Draft => {
    const c = cur as Draft | null;
    if (!c || c.kind !== undefined || c.notes?.length) {
      flush();
      cur = {};
    }
    const d = cur as unknown as Draft;
    d.kind = kind;
    return d;
  };

  let i = 0;
  while (i < lines.length) {
    const [ln, raw] = lines[i];
    const text = pyStrip(raw);
    i++;
    const fence = openFence(raw);
    if (fence) {
      const code: string[] = [];
      while (i < lines.length) {
        const line = lines[i][1];
        i++;
        if (closesFence(line, fence)) break;
        code.push(dedent(line, fence.indent));
      }
      while (code.length && !pyStrip(code[code.length - 1])) code.pop();
      Object.assign(body("code"), { lang: fence.lang, code: code.join("\n") });
      continue;
    }
    if (!text) continue;
    if (PAGEBREAK.test(text)) {
      body("pagebreak");
      continue;
    }
    if (RULE.test(raw)) {
      body("rule");
      continue;
    }
    let m = HEAD.exec(text);
    if (m) {
      flush();
      cur = { title: inlineTitle(m[2] ?? "", dialect) || null };
      continue;
    }
    if (text.startsWith("|")) {
      const rows: [number, string[]][] = [[ln, splitCells(text)]];
      while (i < lines.length && pyStrip(lines[i][1]).startsWith("|")) {
        rows.push([lines[i][0], splitCells(lines[i][1])]);
        i++;
      }
      const t = table(rows, dialect);
      Object.assign(body("table"), { head: t.head, rows: t.rows, talign: t.align });
      continue;
    }
    m = LIST_ITEM.exec(raw.replaceAll("\t", "  "));
    if (m) {
      let rest = m[5];
      let checked: boolean | null = null;
      const task = TASK.exec(rest);
      if (task) {
        checked = task[1] !== " ";
        rest = task[2] ?? "";
      }
      const itemText = canon(rest, "item", dialect);
      if (!itemText) continue;
      const indent = m[1].length;
      const mark = m[2] ?? m[3] + m[4];
      const c = cur as Draft | null;
      const list: Draft = c && c.kind === "list" && !c.notes?.length ? c : Object.assign(body("list"), { items: [], cols: [] });
      const cols = list.cols!;
      let level = 0;
      while (level < cols.length && indent >= cols[level]) level++;
      level = Math.min(level, MAX_LEVEL);
      cols.length = level;
      cols.push(indent + mark.length + 1);
      list.items!.push({ text: itemText, level, ordered: m[2] === undefined, num: m[3] ? Number(m[3]) : 0, checked });
      continue;
    }
    if (EMPTY_ITEM.test(raw)) continue;
    m = NOTE.exec(text);
    if (m) {
      const note = canon(m[1], null, dialect);
      if (note) {
        cur ??= {};
        ((cur as Draft).notes ??= []).push(note);
      }
      continue;
    }
    m = IMAGE.exec(text);
    if (m) {
      Object.assign(body("image"), { src: pyStrip(m[2]), caption: oneLine(m[1]), ...(m[3] ? { width: Number(m[3]) } : {}) });
      continue;
    }
    const [align, inner] = blockAlign(text);
    const para = canon(inner, "para", dialect);
    if (para) Object.assign(body("text"), { text: para, align });
  }
  flush();
  return out;
}

/**
 * MD → 문서. 줄 번호가 든 MdError 를 낸다.
 * 글 서식 태그는 문서의 태그 언어로 쓴다 — 문서에 태그가 있으면 그것, 없으면 dialect(부르는 쪽의 언어), 그것도 없으면 한국어.
 * 섹션 key · 블록 id 는 차례대로 붙인다(s1, b1 …). 서버는 원본 문서의 id 를 잇는다(md.attach_ids).
 */
export function parseMarkdown(text: string, dialect?: Dialect | null): Doc {
  const dl: Dialect = dialectOf(text) ?? dialect ?? "ko";
  let docTitle = "";
  const sections: { title: string; blocks: BlockBody[] }[] = [];
  let cur: [number, string][] = [];
  let curTitle = "";
  let seen = false;
  let fence: Fence | null = null;

  const close = () => {
    const blocks = parseBlocks(cur, dl);
    if (curTitle || blocks.length || sections.length) sections.push({ title: curTitle, blocks });
  };

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((line, k) => {
    const n = k + 1;
    if (fence) {
      cur.push([n, line]);
      if (closesFence(line, fence)) fence = null;
      return;
    }
    const f = openFence(line);
    if (f) {
      fence = f;
      cur.push([n, line]);
      seen = true;
      return;
    }
    const m = HEAD.exec(pyStrip(line));
    const level = m ? m[1].length : 0;
    if (level === 1 && !seen) {
      docTitle = inlineTitle(m![2] ?? "", dl);
    } else if (level === 1 || level === 2) {
      close();
      cur = [];
      curTitle = inlineTitle(m![2] ?? "", dl);
    } else {
      cur.push([n, line]);
    }
    if (pyStrip(line)) seen = true;
  });
  close();
  if (sections.length && !sections[0].title && !sections[0].blocks.length) sections.shift();
  let b = 0;
  const out: Section[] = sections.map((s, i) => ({ key: `s${i + 1}`, title: s.title, blocks: s.blocks.map((blk) => ({ id: `b${++b}`, ...blk }) as Block) }));
  return { title: docTitle, sections: out, dialect: dl };
}
