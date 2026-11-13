// 서버(src/mditor/md.py)의 문서 모양과 같다.
import type { FontKey } from "./fonts";

export type Align = "left" | "center" | "right" | null;
export type Item = { text: string; level: number };

type BlockBase = { id: string; title: string | null; notes: string[] };
export type TextBlock = BlockBase & { kind: "text"; text: string };
export type ListBlock = BlockBase & { kind: "list"; items: Item[] };
export type TableBlock = BlockBase & { kind: "table"; head: string[][]; rows: string[][]; align: Align[] };
export type ImageBlock = BlockBase & { kind: "image"; src: string; caption: string };
export type Block = TextBlock | ListBlock | TableBlock | ImageBlock;

export type Section = { key: string; title: string; blocks: Block[] };
export type Doc = { title: string; sections: Section[] };

/** PDF 를 실제로 그려 본 쪽 배치. */
export type PageLayout = {
  sections: Record<string, number>;
  blocks: Record<string, number>;
  items: Record<string, Record<string, number>>;
  rows: Record<string, Record<string, number>>;
  total: number;
};

export type Changes = {
  added: string[];
  modified: string[];
  removed: { id: string; kind: string; label: string; section: string }[];
  title: boolean;
  sections: boolean;
};

export type MdError = { line: number | null; message: string };

export type Preview =
  | { ok: true; doc: Doc; md: string; canonical: boolean; changes: Changes | null }
  | { ok: false; error: MdError };

export type Options = {
  page: "A4" | "Letter";
  landscape: boolean;
  margin_mm: number;
  font_size: number;
  section_break: boolean;
  page_numbers: boolean;
  font: FontKey;
};

export const DEFAULT_OPTIONS: Options = {
  page: "A4",
  landscape: false,
  margin_mm: 20,
  font_size: 10.5,
  section_break: false,
  page_numbers: true,
  font: "pretendard",
};
