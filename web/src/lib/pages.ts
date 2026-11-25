// 쪽 경계 — 화면은 쪽을 짐작하지 않는다. 서버가 PDF 를 그려 본 결과(PageLayout)에서
// 쪽 번호가 바뀌는 자리를 찾아 그 앞에 'n쪽' 경계를 그린다.

import type { PageMarks } from "@mditor/editor";
import type { Doc, PageLayout } from "./types";

export type BlockPages = {
  /** 블록 앞에 그릴 경계의 쪽 번호(없으면 null) */
  before: number | null;
  /** 목록 항목 앞 경계 — 항목 순번 → 쪽 */
  items: Record<number, number>;
  /** 표 본문 행 앞 경계 — 행 순번 → 쪽 */
  rows: Record<number, number>;
};

export type PageBreaks = {
  sections: Record<string, number>;
  blocks: Record<string, BlockPages>;
};

export function pageBreaks(doc: Doc, layout: PageLayout | null): PageBreaks {
  const out: PageBreaks = { sections: {}, blocks: {} };
  if (!layout) return out;
  let page = 1;
  const step = (p: number | undefined): number | null => {
    if (p === undefined || p <= page) return null;
    page = p;
    return p;
  };
  for (const s of doc.sections) {
    if (s.title) {
      const p = step(layout.sections[s.key]);
      if (p) out.sections[s.key] = p;
    }
    for (const b of s.blocks) {
      const entry: BlockPages = { before: step(layout.blocks[b.id]), items: {}, rows: {} };
      if (b.kind === "list") {
        const pages = layout.items[b.id] ?? {};
        b.items.forEach((_, i) => {
          const p = step(pages[String(i)]);
          if (p && i > 0) entry.items[i] = p;
          else if (p && entry.before === null) entry.before = p;
        });
      } else if (b.kind === "table") {
        const pieces = Object.entries(layout.rows[b.id] ?? {})
          .map(([row, p]) => [Number(row), p] as const)
          .sort((x, y) => x[0] - y[0]);
        for (const [row, p] of pieces) {
          const hit = step(p);
          if (hit && row > 0) entry.rows[row] = hit;
          else if (hit && entry.before === null) entry.before = hit;
        }
      }
      out.blocks[b.id] = entry;
    }
  }
  return out;
}

/**
 * 편집기에 그릴 쪽 경계(자동 쪽 나눔) — 미리보기와 같은 경계를 문서의 순번(섹션 순번 · 블록 순번)으로 옮긴다.
 * 편집기는 같은 문서를 같은 규칙으로 블록으로 묶으므로 순번이 맞는다.
 */
export function editorMarks(doc: Doc, layout: PageLayout | null): PageMarks | null {
  if (!layout) return null;
  const breaks = pageBreaks(doc, layout);
  const out: Required<PageMarks> = { total: layout.total, sections: {}, blocks: {} };
  let ordinal = 0;
  doc.sections.forEach((s, i) => {
    if (breaks.sections[s.key]) out.sections[i] = breaks.sections[s.key];
    for (const b of s.blocks) {
      const p = breaks.blocks[b.id];
      if (p && (p.before || Object.keys(p.items).length || Object.keys(p.rows).length)) out.blocks[ordinal] = { before: p.before, items: p.items, rows: p.rows };
      ordinal++;
    }
  });
  return out;
}
