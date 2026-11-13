// 쪽 경계 — 화면은 쪽을 짐작하지 않는다. 서버가 PDF 를 그려 본 결과(PageLayout)에서
// 쪽 번호가 바뀌는 자리를 찾아 그 앞에 'n쪽' 경계를 그린다.

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
