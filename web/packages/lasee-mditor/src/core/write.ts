// 문서 → MD. 서버 src/mditor/md.py 의 doc_md 와 **같은 규칙**이다(바이트 단위로 같아야 한다).

import { pyStrip, tag, type Dialect, type TextAlign } from "./inline";
import { oneLine } from "./parse";
import type { Align, BlockBody, Doc, Item, Section } from "./types";

const DELIM: Record<string, string> = { null: "---", left: ":---", center: ":---:", right: "---:" };
const ALIGN_TAG: Record<TextAlign, string> = { center: "가운데", right: "오른쪽", justify: "양쪽" };

const row = (cells: string[]) => "| " + cells.map((c) => c.replaceAll("|", "\\|")).join(" | ") + " |";

/** 목록 항목 → 줄들. 번호는 구간마다 시작 번호(start, 없으면 1)부터 이어 세고, 들여쓰기는 부모 항목의 글 시작 칸에 맞춘다. */
export function itemLines(items: Item[]): string[] {
  const lines: string[] = [];
  const cols: number[] = []; // 단계마다 글 시작 칸
  let nums: (number | null)[] = []; // 단계마다 지금 번호(번호 구간이 아니면 null)
  for (const it of items) {
    const level = Math.max(0, Math.min(it.level, cols.length));
    nums = nums.slice(0, level + 1);
    while (nums.length < level + 1) nums.push(null);
    let markerText = "-";
    if (it.ordered) {
      const prev = nums[level];
      const n = prev !== null ? prev + 1 : (it.start ?? 1);
      nums[level] = n;
      markerText = `${n}.`;
    } else nums[level] = null;
    const indent = level === 0 ? 0 : cols[level - 1];
    cols.length = level;
    cols.push(indent + markerText.length + 1);
    const box = it.checked === undefined || it.checked === null ? "" : it.checked ? "[x] " : "[ ] ";
    lines.push(`${" ".repeat(indent)}${markerText} ${box}${it.text}`);
  }
  return lines;
}

/** 코드 블록의 울타리 — 코드 안의 가장 긴 백틱보다 하나 길게(3개 이상). */
export function codeFence(code: string): string {
  let longest = 0;
  let run = 0;
  for (const ch of code) {
    run = ch === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** 문단의 정렬을 태그로 감싼다(`{가운데}…{/가운데}`). */
export function alignText(text: string, align: TextAlign | null | undefined, dialect: Dialect): string {
  if (!align || !text) return text;
  const name = tag(ALIGN_TAG[align], dialect);
  return `{${name}}${text}{/${name}}`;
}

export function blockMd(b: BlockBody, dialect: Dialect = "ko"): string {
  const lines: string[] = [];
  if (b.title) lines.push(`### ${oneLine(b.title)}`);
  switch (b.kind) {
    case "text":
      if (b.text) lines.push(alignText(b.text, b.align, dialect));
      break;
    case "list":
      lines.push(...itemLines(b.items));
      break;
    case "table": {
      lines.push(...b.head.map(row));
      const width = b.head[b.head.length - 1].length;
      const align: Align[] = [...(b.align ?? []), ...Array(width).fill(null)].slice(0, width);
      lines.push("|" + align.map((a) => `${DELIM[String(a)]}|`).join(""));
      lines.push(...b.rows.map(row));
      break;
    }
    case "image":
      lines.push(`![${oneLine(b.caption)}](${pyStrip(String(b.src ?? ""))})`);
      break;
    case "code": {
      const fence = codeFence(b.code);
      lines.push(fence + (b.lang ?? ""));
      if (b.code) lines.push(...b.code.split("\n"));
      lines.push(fence);
      break;
    }
    case "rule":
      lines.push("---");
      break;
    case "pagebreak":
      lines.push("<!-- pagebreak -->");
      break;
  }
  for (const n of b.notes ?? []) if (n) lines.push(`> ${n}`);
  return lines.join("\n");
}

export function sectionMd(s: Pick<Section, "title" | "blocks">, heading = true, dialect: Dialect = "ko"): string {
  const parts = heading ? [`## ${oneLine(s.title)}`.trimEnd()] : [];
  parts.push(...(s.blocks ?? []).map((b) => blockMd(b, dialect)));
  return parts.filter(Boolean).join("\n\n");
}

/** 문서 → MD. 블록 사이는 빈 줄 하나, 끝은 줄바꿈 하나. 정렬 태그는 문서의 태그 언어(doc.dialect)로 쓴다. */
export function docToMarkdown(doc: Doc, dialect?: Dialect): string {
  const dl = dialect ?? doc.dialect ?? "ko";
  const parts: string[] = [];
  if (doc.title) parts.push(`# ${oneLine(doc.title)}`);
  (doc.sections ?? []).forEach((s, i) => parts.push(sectionMd(s, !!s.title || i > 0, dl)));
  const body = parts.filter(Boolean).join("\n\n");
  return body ? body + "\n" : "";
}
