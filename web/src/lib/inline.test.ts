import { describe, expect, it } from "vitest";
import fixture from "./rich/fixture.json";
import { canon, cellShade, dialectOf, normalize, segments, title, write, type Ctx, type Seg } from "./inline";
import { canonical, spans } from "./table";

const CTX: Ctx[] = [null, "cell", "para", "item"];

describe("글 서식 — 서버와 같은 결과", () => {
  it("읽기 · 표준 꼴 · 칸 음영", () => {
    for (const c of fixture.inline) {
      expect(normalize(segments(c.src)), c.src).toEqual(c.segs);
      CTX.forEach((ctx, i) => expect(canon(c.src, ctx), `${c.src} (${ctx})`).toBe(c.canon[i]));
      CTX.forEach((ctx, i) => expect(canon(c.src, ctx, "en"), `${c.src} (${ctx}, en)`).toBe(c.canonEn[i]));
      expect(cellShade(c.src), c.src).toEqual(c.cellShade);
    }
  });

  it("무작위 조각 400개 — 다듬기 · 쓰기 · 다시 읽기", () => {
    for (const c of fixture.random) {
      const norm = normalize(c.raw as Seg[]);
      expect(norm).toEqual(c.norm);
      CTX.forEach((ctx, i) => {
        const s = write(norm, ctx);
        expect(s).toBe(c.md[i]);
        expect(normalize(segments(s))).toEqual(c.norm);
        const en = write(norm, ctx, "en");
        expect(en).toBe(c.mdEn[i]);
        expect(normalize(segments(en))).toEqual(c.norm);
      });
    }
  });
});

describe("제목의 표준 꼴 — 서버와 같은 결과", () => {
  it("서식은 본문과 같고, 줄바꿈은 빈칸, 이어진 빈칸은 하나", () => {
    for (const c of fixture.titles) {
      expect(title(c.src), JSON.stringify(c.src)).toBe(c.ko);
      expect(title(c.src, "en"), JSON.stringify(c.src)).toBe(c.en);
    }
  });
});

describe("문서의 태그 언어 — 서버와 같은 결과", () => {
  it("처음 나오는 짝 맞은 태그가 정한다", () => {
    for (const c of fixture.dialect) expect(dialectOf(c.src), c.src.slice(0, 40)).toBe(c.dialect);
  });
});

describe("표 칸 합치기 — 서버와 같은 결과", () => {
  it("범위 · 숨은 칸 · 표준 기호", () => {
    for (const t of fixture.tables) {
      const sp = spans(t.rows);
      const got: number[][] = [];
      const hidden: number[][] = [];
      sp.forEach((row, r) =>
        row.forEach((s, c) => {
          if (s.hidden) hidden.push([r, c]);
          else if (s.rowSpan > 1 || s.colSpan > 1) got.push([r, c, s.rowSpan, s.colSpan]);
        }),
      );
      expect(got).toEqual(t.spans);
      expect(hidden).toEqual(t.hidden);
      expect(canonical(t.rows)).toEqual(t.canonical);
    }
  });
});
