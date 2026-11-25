import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../core/parse";
import { toPM } from "./convert";
import { listNumbers, pageMarkPlaces } from "./plugins";
import { richExtensions } from "./schema";

const schema = getSchema(richExtensions());
const open = (md: string) => schema.nodeFromJSON(toPM(parseMarkdown(md)));

const MD = `# 문서

머리 없는 첫 섹션의 문단

## 1. 목록

### 제목 있는 블록
- 가
- 
- 나
- 다
> 비고

## 2. 표

| 머리 |
| ^ |
|---|
| 1 |
| 2 |
| 3 |

문단
`;

describe("자동 쪽 나눔 — 경계 자리", () => {
  const doc = open(MD);
  const at = (pos: number) => doc.nodeAt(pos);

  it("섹션 머리 · 블록 앞 · 목록 항목 앞 · 표 본문 행 앞", () => {
    const places = pageMarkPlaces(doc, {
      total: 5,
      sections: { 2: 3 }, // 셋째 섹션(## 2. 표)
      blocks: { 1: { before: 2, items: { 2: 2 } }, 2: { rows: { 1: 4 } }, 3: { before: 5 } },
    });
    expect(places.map((p) => [p.kind, p.page])).toEqual([
      ["block", 2],
      ["item", 2],
      ["block", 3],
      ["row", 4],
      ["block", 5],
    ]);
    const [block, item, section, row, last] = places;
    expect(at(block.pos)?.type.name).toBe("blockTitle"); // 블록은 제목부터
    expect(at(item.pos)?.textContent).toBe("다"); // 빈 항목은 세지 않는다 — 셋째 항목은 '다'
    expect(at(section.pos)?.type.name).toBe("sectionHead");
    expect(at(row.pos)?.textContent).toBe("2"); // 머리글 두 줄 다음 본문 둘째 행
    expect(row.width).toBe(1);
    expect(at(last.pos)?.textContent).toBe("문단");
  });

  it("없는 순번은 건너뛴다", () => {
    expect(pageMarkPlaces(doc, { total: 1, sections: { 9: 2 }, blocks: { 9: { before: 2 } } })).toEqual([]);
  });

  it("번호 목록의 번호도 같은 규칙", () => {
    const d = open("3. 가\n4. 나\n   - 다\n5. 라\n");
    expect([...listNumbers(d).values()]).toEqual([3, 4, 5]);
  });
});
