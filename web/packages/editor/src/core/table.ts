// 표 칸 합치기. 서버 src/mditor/table.py 와 **같은 규칙**이다. 고치면 둘 다 고친다.
//
// 칸에 `<` 만 있으면 왼쪽 칸과, `^` 만 있으면 위 칸과 합친다.
// 합친 모양이 직사각형이 아니거나 합칠 칸이 없으면 글자 그대로 둔다. 머리글과 본문은 따로 합친다.

export type CellSpan = { hidden: boolean; rowSpan: number; colSpan: number };

export function marker(cell: string): "<" | "^" | null {
  return cell === "<" || cell === "^" ? cell : null;
}

const key = (r: number, c: number) => `${r},${c}`;

/** 격자 → 칸마다 {숨은 칸인지, 행 수, 열 수}. */
export function spans(rows: string[][]): CellSpan[][] {
  const owner = new Map<string, [number, number]>();
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      const m = marker(cell);
      if (m === "<" && c > 0) owner.set(key(r, c), owner.get(key(r, c - 1))!);
      else if (m === "^" && r > 0 && c < rows[r - 1].length) owner.set(key(r, c), owner.get(key(r - 1, c))!);
      else owner.set(key(r, c), [r, c]);
    }),
  );
  const groups = new Map<string, [number, number][]>();
  rows.forEach((row, r) =>
    row.forEach((_, c) => {
      const a = owner.get(key(r, c))!;
      const k = key(a[0], a[1]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([r, c]);
    }),
  );
  const out: CellSpan[][] = rows.map((row) => row.map(() => ({ hidden: false, rowSpan: 1, colSpan: 1 })));
  for (const [k, cells] of groups) {
    if (cells.length === 1) continue;
    const [ar, ac] = k.split(",").map(Number);
    const r0 = Math.min(...cells.map((p) => p[0]));
    const r1 = Math.max(...cells.map((p) => p[0]));
    const c0 = Math.min(...cells.map((p) => p[1]));
    const c1 = Math.max(...cells.map((p) => p[1]));
    const h = r1 - r0 + 1;
    const w = c1 - c0 + 1;
    if (ar !== r0 || ac !== c0 || cells.length !== h * w) continue; // 직사각형이 아니다 — 글자 그대로
    out[ar][ac] = { hidden: false, rowSpan: h, colSpan: w };
    for (const [r, c] of cells) if (r !== ar || c !== ac) out[r][c] = { hidden: true, rowSpan: 1, colSpan: 1 };
  }
  return out;
}

/** 합치기 기호를 표준 꼴로: 숨은 칸이 기준 칸과 같은 행이면 `<`, 아니면 `^`. 합쳐지지 않는 기호는 이스케이프. */
export function canonical(rows: string[][]): string[][] {
  const sp = spans(rows);
  const anchorRow = new Map<string, number>();
  sp.forEach((row, r) =>
    row.forEach((s, c) => {
      if (s.rowSpan === 1 && s.colSpan === 1) return;
      for (let rr = r; rr < r + s.rowSpan; rr++) for (let cc = c; cc < c + s.colSpan; cc++) anchorRow.set(key(rr, cc), r);
    }),
  );
  return rows.map((row, r) =>
    row.map((cell, c) => {
      if (sp[r][c].hidden) return anchorRow.get(key(r, c)) === r ? "<" : "^";
      return marker(cell) ? "\\" + cell : cell;
    }),
  );
}
