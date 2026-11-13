from mditor import table


def test_spans():
    rows = [["a", "<", "c"], ["^", "^", "d"], ["e", "f", "<"]]
    sp, hidden = table.spans(rows)
    assert sp == {(0, 0): (2, 2), (2, 1): (1, 2)}
    assert hidden == {(0, 1), (1, 0), (1, 1), (2, 2)}


def test_edge_markers_are_literal():
    sp, _ = table.spans([["<", "a"], ["^", "b"]])  # 첫 열의 <, 그 아래 ^ 는 위 칸과 합쳐진다
    assert (0, 0) in sp and sp[(0, 0)] == (2, 1)
    sp, _ = table.spans([["^", "<"]])  # 첫 행의 ^ 는 글자, 그 옆 < 는 그 칸과 합친다
    assert sp == {(0, 0): (1, 2)}


def test_l_shape_is_literal():
    rows = [["기준", "<"], ["^", "따로"]]  # ㄱ자 — 직사각형이 아니다
    sp, hidden = table.spans(rows)
    assert sp == {} and hidden == set()
    assert table.canonical(rows) == [["기준", "\\<"], ["\\^", "따로"]]


def test_canonical_markers():
    rows = [["a", "<"], ["^", "<"]]  # 2×2: 아래 오른쪽은 기준 칸과 다른 행이라 ^
    assert table.canonical(rows) == [["a", "<"], ["^", "^"]]


def test_br_is_not_marker():
    assert table.marker("<br>") is None and table.marker("a<") is None and table.marker("<") == "<"
