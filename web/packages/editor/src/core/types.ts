// 문서 모양 — 서버(src/mditor/md.py)의 문서 JSON 과 같다.
//
// 문서 = 제목 + 섹션(## 큰 제목) 목록. 섹션 = 블록 목록.
// 블록 = (제목 ###) + 본문 하나(문단 · 목록 · 표 · 그림 · 코드 · 가로줄 · 쪽 나눔) + 비고(>) 목록.

import type { Dialect, TextAlign } from "./inline";

export type Align = "left" | "center" | "right" | null;

/** 목록 항목. ordered: 번호 항목(`1.`), start: 번호가 이어지는 구간의 첫 항목만 — 1이 아닐 때, checked: 할 일 항목(`[ ]` · `[x]`). */
export type Item = { text: string; level: number; ordered?: boolean; start?: number; checked?: boolean };

type BlockBase = { id: string; title: string | null; notes: string[] };
export type TextBlock = BlockBase & { kind: "text"; text: string; align?: TextAlign };
export type ListBlock = BlockBase & { kind: "list"; items: Item[] };
export type TableBlock = BlockBase & { kind: "table"; head: string[][]; rows: string[][]; align: Align[] };
export type ImageBlock = BlockBase & { kind: "image"; src: string; caption: string };
export type CodeBlock = BlockBase & { kind: "code"; lang: string; code: string };
export type RuleBlock = BlockBase & { kind: "rule" };
export type PageBreakBlock = BlockBase & { kind: "pagebreak" };
export type Block = TextBlock | ListBlock | TableBlock | ImageBlock | CodeBlock | RuleBlock | PageBreakBlock;
export type BlockKind = Block["kind"];
/** id 없는 블록(읽는 중 · 쓰기 전). */
export type BlockBody = { [K in BlockKind]: Omit<Extract<Block, { kind: K }>, "id"> }[BlockKind];

export type Section = { key: string; title: string; blocks: Block[] };
/** dialect: 문서의 태그 언어(읽을 때 정해진다). 정렬 태그를 쓸 때 쓴다. */
export type Doc = { title: string; sections: Section[]; dialect?: Dialect };

/** MD 를 읽다 난 오류. line 은 1부터 센다. code 는 문구를 고를 열쇠, params 는 문구에 채울 값. */
export class MdError extends Error {
  constructor(
    public line: number | null,
    public code: MdErrorCode,
    public params: Record<string, string | number> = {},
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MdError";
  }
}

export type MdErrorCode = "table-no-delim" | "table-no-head" | "table-too-wide" | "table-row-too-long";
