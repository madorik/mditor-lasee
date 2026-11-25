// @mditor/editor/core — 화면 없이 쓰는 부분(브라우저 · Node 어디서나). TipTap 을 싣지 않는다.
//
//   import { parseMarkdown, docToMarkdown, renderHtml } from "@mditor/editor/core";

export { parseMarkdown, parseBlocks, splitCells, MAX_LEVEL, MAX_COLS } from "./core/parse";
export { docToMarkdown, blockMd, sectionMd, itemLines, codeFence } from "./core/write";
export { renderHtml, blockHtml, inlineHtml, escapeHtml, itemNumbers, type HtmlOptions } from "./core/html";
export {
  segments,
  normalize,
  write,
  canon,
  title,
  plainInline,
  dialectOf,
  cellShade,
  blockAlign,
  tag,
  isColor,
  colorCss,
  safeHref,
  linkHref,
  oneSpace,
  pyStrip,
  INLINE_COLORS,
  SHADE,
  MARK,
  SPACES,
  type Seg,
  type Ctx,
  type Dialect,
  type Script,
  type TextAlign,
} from "./core/inline";
export { spans, canonical, marker, type CellSpan } from "./core/table";
export { MdError, type Doc, type Section, type Block, type BlockKind, type Item, type Align, type TextBlock, type ListBlock, type TableBlock, type ImageBlock, type CodeBlock, type RuleBlock, type PageBreakBlock, type MdErrorCode } from "./core/types";
