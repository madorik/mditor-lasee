"""표 칸 합치기.

web/src/lib/table.ts 와 **같은 규칙**이다. 고치면 둘 다 고친다.

칸에 ``<`` 만 있으면 왼쪽 칸과, ``^`` 만 있으면 위 칸과 합친다. 행마다 칸 수가 그대로라 일반 MD 표로도 읽힌다.
- 머리글과 본문은 따로 합친다(이 함수는 한쪽 격자만 받는다).
- 합친 모양이 직사각형이 아니거나, 첫 열의 ``<`` · 첫 행의 ``^`` 처럼 합칠 칸이 없으면 글자 그대로 둔다.
- 기호 검사는 칸 전체를 정확히 비교한다(``"<" in cell`` 은 ``<br>`` 에도 걸린다).
"""

from __future__ import annotations

Pos = tuple[int, int]


def marker(cell: str) -> str | None:
    return cell if cell in ("<", "^") else None


def spans(rows: list[list[str]]) -> tuple[dict[Pos, tuple[int, int]], set[Pos]]:
    """격자 → ({기준 칸: (행 수, 열 수)}, 숨은 칸 집합). 합쳐지지 않은 칸은 어디에도 없다."""
    owner: dict[Pos, Pos] = {}
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            m = marker(cell)
            if m == "<" and c > 0:
                owner[(r, c)] = owner[(r, c - 1)]
            elif m == "^" and r > 0 and c < len(rows[r - 1]):
                owner[(r, c)] = owner[(r - 1, c)]
            else:
                owner[(r, c)] = (r, c)

    groups: dict[Pos, list[Pos]] = {}
    for pos, anchor in owner.items():
        groups.setdefault(anchor, []).append(pos)

    out: dict[Pos, tuple[int, int]] = {}
    hidden: set[Pos] = set()
    for anchor, cells in groups.items():
        if len(cells) == 1:
            continue
        r0, r1 = min(r for r, _ in cells), max(r for r, _ in cells)
        c0, c1 = min(c for _, c in cells), max(c for _, c in cells)
        h, w = r1 - r0 + 1, c1 - c0 + 1
        if anchor != (r0, c0) or len(cells) != h * w:
            continue  # 직사각형이 아니다 — 글자 그대로
        out[anchor] = (h, w)
        hidden.update(p for p in cells if p != anchor)
    return out, hidden


def canonical(rows: list[list[str]]) -> list[list[str]]:
    """합치기 기호를 표준 꼴로: 숨은 칸이 기준 칸과 같은 행이면 ``<``, 아니면 ``^``.
    합쳐지지 않는 기호는 글자이므로 이스케이프(``\\<`` ``\\^``)한다."""
    sp, hidden = spans(rows)
    anchor_row: dict[Pos, int] = {}
    for (r, c), (h, w) in sp.items():
        for rr in range(r, r + h):
            for cc in range(c, c + w):
                anchor_row[(rr, cc)] = r
    out: list[list[str]] = []
    for r, row in enumerate(rows):
        line: list[str] = []
        for c, cell in enumerate(row):
            if (r, c) in hidden:
                line.append("<" if anchor_row[(r, c)] == r else "^")
            elif marker(cell):
                line.append("\\" + cell)
            else:
                line.append(cell)
        out.append(line)
    return out
