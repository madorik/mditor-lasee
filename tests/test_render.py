"""PDF 렌더와 쪽 배치 — 배치가 말하는 쪽에 그 블록이 실제로 그려졌는지 PDF 를 다시 읽어 확인한다."""

import io

import pytest
from pypdf import PdfReader

from mditor import md, render
from mditor.render import Options
from mditor.settings import example_md

from .synthetic import MD

PNG_1PX = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def pages_text(pdf: bytes) -> list[str]:
    return ["".join((p.extract_text() or "").split()) for p in PdfReader(io.BytesIO(pdf)).pages]


def squash(s: str) -> str:
    return "".join(s.split())


def long_doc() -> str:
    parts = ["# 긴 문서"]
    for s in range(1, 7):
        parts.append(f"## {s}. 섹션{s}")
        parts.append(f"### 목록{s}\n" + "\n".join(f"- 섹션{s}항목{i}번 내용이 이어진다" for i in range(1, 26)))
        parts.append(
            f"### 표{s}\n| 번호 | 내용 |\n|---|---|\n" + "\n".join(f"| 표{s}행{r} | 표{s}의 {r}번째 행 내용 |" for r in range(1, 71))
        )
        parts.append(f"섹션{s}의 맺음 문단이다.")
    return "\n\n".join(parts) + "\n"


def test_example_renders():
    doc = md.apply_md(None, example_md())
    pdf, layout = render.render(doc)
    assert pdf.startswith(b"%PDF") and layout["total"] == len(PdfReader(io.BytesIO(pdf)).pages) == 2
    assert set(layout["blocks"]) == {b["id"] for s in doc["sections"] for b in s["blocks"]}
    assert set(layout["sections"]) == {s["key"] for s in doc["sections"]}


def test_synthetic_renders_every_block():
    doc = md.apply_md(None, MD)
    pdf, layout = render.render(doc)
    assert set(layout["blocks"]) == {b["id"] for s in doc["sections"] for b in s["blocks"]}
    text = "".join(pages_text(pdf))
    for needle in ("굵게굵고취소다시굵게", "1.31**", "a|b", "C:\\Users\\me", "ㄱ자로어긋난기호", "그림설명(2026)"):
        assert needle in text, needle


def test_layout_matches_the_pdf():
    """배치가 말하는 쪽에 블록 · 항목 · 표 행이 실제로 있다 — 화면의 쪽 경계가 PDF 와 같다는 근거."""
    doc = md.apply_md(None, long_doc())
    pdf, layout = render.render(doc)
    pages = pages_text(pdf)
    assert layout["total"] == len(pages) > 10
    checked = 0
    for s in doc["sections"]:
        assert squash(s["title"]) in pages[layout["sections"][s["key"]] - 1]
        for b in s["blocks"]:
            page = pages[layout["blocks"][b["id"]] - 1]
            assert squash(b["title"] or b.get("text") or "") in page
            if b["kind"] == "list":
                for i, it in enumerate(b["items"]):
                    assert squash(it["text"]) in pages[layout["items"][b["id"]][str(i)] - 1], it["text"]
                    checked += 1
            elif b["kind"] == "table":
                pieces = sorted((int(k), v) for k, v in layout["rows"][b["id"]].items())
                assert len(pieces) > 1  # 70행 표는 쪽을 넘어 나뉜다
                for n, (first, pg) in enumerate(pieces):
                    last = pieces[n + 1][0] if n + 1 < len(pieces) else len(b["rows"])
                    for r in range(first, last):  # 이 조각의 행은 모두 그 쪽에 있다
                        assert squash(b["rows"][r][0]) in pages[pg - 1], (b["title"], r, pg)
                        checked += 1
                    if n:  # 머리글이 다음 쪽에 다시 나온다
                        assert "번호내용" in pages[pg - 1]
    assert checked > 500


def test_block_moves_whole_to_next_page():
    """남은 자리에 안 들어가는 블록은 통째로 다음 쪽으로 간다(제목만 앞 쪽에 남지 않는다)."""
    filler = "\n\n".join(f"채움 문단 {i}." for i in range(1, 29))
    text = f"## 가\n\n{filler}\n\n### 넘어갈 블록\n" + "\n".join(f"- 넘어갈 항목 {i}" for i in range(1, 9)) + "\n"
    doc = md.apply_md(None, text)
    _, layout = render.render(doc)
    block = doc["sections"][0]["blocks"][-1]
    pages = set(layout["items"][block["id"]].values()) | {layout["blocks"][block["id"]]}
    assert pages == {2} and layout["total"] == 2


def test_options_change_layout():
    doc = md.apply_md(None, long_doc())
    base = render.render(doc)[1]["total"]
    assert render.render(doc, Options(font_size=13))[1]["total"] > base
    assert render.render(doc, Options(landscape=True))[1]["total"] != base
    broken = render.render(doc, Options(section_break=True))[1]
    firsts = [broken["sections"][s["key"]] for s in doc["sections"]]
    assert firsts == sorted(set(firsts))  # 섹션마다 새 쪽
    assert Options.from_json({"margin_mm": 999, "font_size": "x", "page": "letter"}) == Options(page="Letter", margin_mm=40.0)


def test_images_same_layout_with_bytes_or_sizes():
    """쪽 배치는 그림 크기만 알아도 그림 바이트가 있을 때와 같다."""
    body = "\n\n".join(f"문단 {i}." for i in range(1, 20))
    text = f"## 가\n\n{body}\n\n![설명](a.png)\n\n{body}\n"
    doc = md.apply_md(None, text)
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (800, 500), "#336699").save(buf, "PNG")
    with_bytes = render.render(doc, images={"a.png": buf.getvalue()})[1]
    with_sizes = render.render(doc, image_sizes={"a.png": [800, 500]})[1]
    assert with_bytes == with_sizes
    assert render.render(md.apply_md(None, f"![점]({PNG_1PX})\n"))[1]["total"] == 1
    assert render.render(md.apply_md(None, "![없는 그림](없음.png)\n"))[0].startswith(b"%PDF")  # 없는 그림은 자리만


def test_hanja_and_symbols_have_glyphs():
    render._register()
    from reportlab.pdfbase import pdfmetrics

    face = pdfmetrics.getFont(render.FONT).face
    for ch in "韓國漢字前年比對※①→■△㈜㎡":
        assert ord(ch) in face.charToGlyph, ch


@pytest.mark.parametrize("text", ["", "\n\n", "# 제목만\n", "## 섹션만\n"])
def test_tiny_documents(text):
    pdf, layout = render.render(md.apply_md(None, text))
    assert pdf.startswith(b"%PDF") and layout["total"] == 1


# ───────────── 번호 · 할 일 · 코드 · 가로줄 · 쪽 나눔 · 정렬 · 링크 ─────────────


def blocks(doc):
    return [b for s in doc["sections"] for b in s["blocks"]]


def render_md(text, **opts):
    doc = md.apply_md(None, text)
    pdf, layout = render.render(doc, Options(**opts))
    return doc, pdf, layout


def test_new_syntax_renders_in_every_font():
    doc = md.apply_md(None, MD)
    kinds = {b["kind"] for b in blocks(doc)}
    assert {"code", "rule", "pagebreak"} <= kinds
    for font in render.FAMILIES:
        pdf, layout = render.render(doc, Options(font=font))
        assert pdf.startswith(b"%PDF")
        assert set(layout["blocks"]) == {b["id"] for b in blocks(doc)}  # 쪽 나눔 · 가로줄 블록도 쪽이 적힌다
    text = "".join(pages_text(render.render(doc)[0]))
    for needle in ("deff():", "섹션머리가아니다", "닫히지않은코드", "하위할일굵게", "일곱부터", "형광펜", "H2O", "x2"):
        assert needle in text, needle


def test_ordered_numbers_and_task_boxes_are_drawn():
    _, pdf, layout = render_md("1. 하나\n2. 둘\n   1. 아래\n   2. 아래 둘\n3. 셋\n- [ ] 할 일\n- [x] 끝\n10. 열\n11. 열하나\n- 글머리\n")
    page = pages_text(pdf)[0]
    # MD 에 쓰는 번호와 같은 번호가 나온다(번호 구간은 start 부터 이어 센다)
    assert "1.하나" in page and "2.둘" in page and "1.아래" in page and "2.아래둘" in page and "3.셋" in page
    assert "□할일" in page and "■끝" in page and "10.열" in page and "11.열하나" in page and "•글머리" in page
    assert md.item_markers(md.apply_md(None, "1. a\n2. b\n- c\n5. d\n")["sections"][0]["blocks"][0]["items"]) == [
        (0, "1."), (0, "2."), (0, None), (0, "5."),
    ]
    assert len(layout["items"]) == 1


def test_ordered_numbers_match_the_markdown():
    text = "1. a\n2. b\n   - c\n   - d\n     1. e\n3. f\n9) g\n- [ ] h\n7. i\n"
    doc = md.apply_md(None, text)
    lines = md.item_lines(doc["sections"][0]["blocks"][0]["items"])
    marks = md.item_markers(doc["sections"][0]["blocks"][0]["items"])
    for line, (_, num) in zip(lines, marks):
        assert (num is None) == (line.strip().split()[0] == "-"), line
        if num:
            assert line.strip().startswith(num + " "), line


def test_wide_numbers_do_not_collide_with_text():
    _, pdf, _ = render_md("".join(f"{n}. 항목{n}\n" for n in range(98, 103)))
    page = pages_text(pdf)[0]
    assert "98.항목98" in page and "102.항목102" in page


def test_code_block_keeps_spaces_wraps_and_has_a_background():
    long_line = "x = '" + "가나다라마바사" * 40 + "'"
    doc, pdf, layout = render_md(f"```py\ndef f():\n    return 1\n{long_line}\n```\n")
    text = pages_text(pdf)[0]
    assert "deff():" in text and "return1" in text
    assert squash("가나다라마바사" * 40) in text  # 긴 줄은 잘리지 않고 꺾인다
    runs = []  # 코드 줄 앞의 빈칸이 그대로 그려진다
    PdfReader(io.BytesIO(pdf)).pages[0].extract_text(visitor_text=lambda t, cm, tm, fd, fs: runs.append(t))
    assert "    return 1\n" in runs
    assert b"Courier" in pdf  # 코드는 Courier
    assert layout["blocks"][blocks(doc)[0]["id"]] == 1


def test_long_code_block_splits_across_pages_without_losing_lines():
    lines = [f"line_{i:03d} = {i}" for i in range(200)]
    doc, pdf, layout = render_md("앞 문단\n\n```\n" + "\n".join(lines) + "\n```\n\n뒤 문단\n")
    pages = pages_text(pdf)
    assert len(pages) >= 3
    joined = "".join(pages)
    for i in (0, 77, 199):
        assert f"line_{i:03d}={i}" in joined
    assert all(f"line_{i:03d}={i}" in joined for i in range(200))
    code = blocks(doc)[1]
    assert layout["blocks"][code["id"]] == 1 and layout["blocks"][blocks(doc)[2]["id"]] == layout["total"]
    assert "line_000" in pages[0] and "line_199" in pages[-1]  # 처음은 첫 쪽에, 끝은 마지막 쪽에
    # 한 쪽에 들어가는 코드 블록은 나누지 않고 통째로 다음 쪽으로 간다
    filler = "\n\n".join(f"채움 문단 {i}." for i in range(1, 29))
    doc, _, layout = render_md(f"{filler}\n\n```\n" + "\n".join(f"c{i}" for i in range(12)) + "\n```\n")
    assert layout["blocks"][blocks(doc)[-1]["id"]] == 2 and layout["total"] == 2


def test_rule_is_drawn_and_reported():
    doc, _, layout = render_md("위\n\n---\n\n아래\n")
    rule = blocks(doc)[1]
    assert rule["kind"] == "rule" and layout["blocks"][rule["id"]] == 1 and layout["total"] == 1
    _, with_rule, _ = render_md("위\n\n---\n\n아래\n")
    _, without, _ = render_md("위\n\n아래\n")
    assert len(with_rule) != len(without)


def test_pagebreak_forces_a_new_page():
    doc, pdf, layout = render_md("앞 문단\n\n<!-- pagebreak -->\n\n뒤 문단\n")
    before, brk, after = blocks(doc)
    assert layout["total"] == 2
    assert layout["blocks"][before["id"]] == 1 and layout["blocks"][brk["id"]] == 1 and layout["blocks"][after["id"]] == 2
    pages = pages_text(pdf)
    assert "앞문단" in pages[0] and "뒤문단" not in pages[0] and "뒤문단" in pages[1]
    # 쪽 맨 위의 쪽 나눔 · 이어진 쪽 나눔 · 문서 처음과 끝의 쪽 나눔은 빈 쪽을 만들지 않는다
    for text, total in (
        ("<!-- pagebreak -->\n\n글\n", 1),
        ("글\n\n<!-- pagebreak -->\n", 1),
        ("글\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n", 1),
        ("가\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\n나\n", 2),
        ("가\n\n<!-- pagebreak -->\n\n나\n\n<!-- pagebreak -->\n\n다\n", 3),
    ):
        _, pdf, layout = render_md(text)
        assert layout["total"] == len(PdfReader(io.BytesIO(pdf)).pages) == total, text
    # 섹션마다 새 쪽 + 섹션 끝의 쪽 나눔도 빈 쪽을 만들지 않는다
    _, _, layout = render_md("## 가\n\n글\n\n<!-- pagebreak -->\n\n## 나\n\n글\n", section_break=True)
    assert layout["total"] == 2
    # 쪽 나눔 뒤 블록의 쪽은 PDF 에서도 새 쪽이다
    doc, pdf, layout = render_md("### 첫째\n- 가\n\n<!-- pagebreak -->\n\n### 둘째\n- 나\n\n<!-- pagebreak -->\n\n### 셋째\n- 다\n")
    pages = pages_text(pdf)
    for b, name in zip((blocks(doc)[0], blocks(doc)[2], blocks(doc)[4]), ("첫째", "둘째", "셋째")):
        assert name in pages[layout["blocks"][b["id"]] - 1]
    assert [layout["blocks"][b["id"]] for b in blocks(doc) if b["kind"] == "list"] == [1, 2, 3]


def test_pagebreak_in_the_middle_of_a_long_document_keeps_layout_matching_the_pdf():
    body = "\n\n".join(f"문단 {i}번 내용이 이어진다." for i in range(1, 30))
    doc, pdf, layout = render_md(f"## 가\n\n{body}\n\n<!-- pagebreak -->\n\n### 새 쪽\n- 항목\n\n{body}\n")
    pages = pages_text(pdf)
    marked = next(b for b in blocks(doc) if b.get("title") == "새 쪽")
    page = layout["blocks"][marked["id"]]
    assert page >= 2 and "새쪽" in pages[page - 1] and "새쪽" not in "".join(pages[: page - 1])
    assert layout["total"] == len(pages)


def test_aligned_paragraphs_move_on_the_page():
    from reportlab.lib.pagesizes import A4

    xs = {}
    for align, tag in (("left", None), ("center", "가운데"), ("right", "오른쪽")):
        text = f"{{{tag}}}정렬{{/{tag}}}\n" if tag else "정렬\n"
        _, pdf, _ = render_md(text)
        found: list[float] = []

        def visit(t, cm, tm, fd, fs, found=found):
            if "정렬" in t:
                found.append(tm[4] + cm[4])

        PdfReader(io.BytesIO(pdf)).pages[0].extract_text(visitor_text=visit)
        xs[align] = found[0]
    assert xs["left"] < xs["center"] < xs["right"] < A4[0]
    _, pdf, _ = render_md("{양쪽}" + "양쪽 정렬 문단 " * 30 + "{/양쪽}\n")
    assert pdf.startswith(b"%PDF")


def test_links_become_annotations_only_for_safe_addresses():
    _, pdf, _ = render_md("[열림](https://example.com/a?b=1&c=2) [메일](mailto:a@b.c) [위험](javascript:alert(1)) [상대](/rel) [표](https://t.io)\n\n| [칸](https://cell.io) |\n|---|\n| x |\n")
    uris = []
    for page in PdfReader(io.BytesIO(pdf)).pages:
        for annot in page.get("/Annots") or []:
            uris.append(annot.get_object()["/A"]["/URI"])
    assert uris == ["https://example.com/a?b=1&c=2", "mailto:a@b.c", "https://t.io", "https://cell.io"]
    assert "위험" in pages_text(pdf)[0] and "상대" in pages_text(pdf)[0]


def test_inline_code_mark_and_scripts_render_without_losing_text():
    _, pdf, _ = render_md("문장 `코드 한글 abc` ==형광펜== H<sub>2</sub>O x<sup>2</sup> `` a`b `` {빨강}`색 코드`{/빨강}\n", font="nanum-myeongjo")
    text = pages_text(pdf)[0]
    for needle in ("코드한글abc", "형광펜", "H2O", "x2", "a`b", "색코드"):
        assert needle in text, needle


def test_list_page_report_covers_new_items():
    from mditor import core

    items = "\n".join(f"{i}. 항목 {i}번 내용" for i in range(1, 120))
    doc, _, layout = render_md(f"### 긴 번호 목록\n{items}\n")
    report = core.page_report(doc, layout)
    block = report["sections"][0]["blocks"][0]
    assert report["total_pages"] >= 2 and block["page"] == 1 and block["continues"][0]["page"] == 2
    pages = pages_text(render.render(doc)[0])
    first_on_next = block["continues"][0]["item"]
    assert f"{first_on_next}.항목{first_on_next}번내용" in pages[1]


# ───────── 쪽 계산(그리지 않고 배치만) ─────────

_LAYOUT_DOCS = [
    example_md(),
    MD,
    long_doc(),
    "## 가\n\n"
    + "\n\n".join(f"문단 {i}번 내용이 이어진다." for i in range(1, 25))
    + "\n\n![설명](a.png)\n\n```py\n"
    + "\n".join(f"print({i})  # 줄 {i}" for i in range(1, 90))
    + "\n```\n\n<!-- pagebreak -->\n\n### 새 쪽\n1. 하나\n- [x] 끝\n\n---\n\n{가운데}가운데{/가운데}\n",
    # 표 칸 안의 그림 · 그림 폭
    "## 사진\n\n| 사진 | 설명 |\n|:---:|---:|\n"
    + "\n".join(f"| ![a{i}](a.png){{width={20 + i}%}} | 설명 {i}<br>![b](a.png) 뒤 |" for i in range(1, 9))
    + "\n\n![큰 그림](a.png){width=90%}\n",
]


@pytest.mark.parametrize(
    "opts",
    [
        Options(),
        Options(font_size=13),
        Options(landscape=True, page="Letter"),
        Options(section_break=True, page_numbers=True, font="nanum-myeongjo", margin_mm=30),
    ],
)
def test_layout_only_is_the_same_as_the_drawn_pdf(opts):
    """쪽 계산은 그리지 않고 배치만 한다 — 그 결과가 실제로 그린 PDF 의 배치와 같아야 화면의 쪽 경계가 PDF 와 맞는다."""
    sizes = {"a.png": [800, 500]}
    for text in _LAYOUT_DOCS:
        doc = md.apply_md(None, text)
        drawn_pdf, drawn = render.render(doc, opts, image_sizes=sizes)
        only_pdf, only = render.render(doc, opts, image_sizes=sizes, draw=False)
        assert only == drawn and only_pdf == b""
        assert drawn["total"] == len(PdfReader(io.BytesIO(drawn_pdf)).pages)


def test_layout_only_leaves_drawing_intact():
    """배치만 한 뒤에도(도중에 실패했더라도) PDF 는 그대로 그린다."""
    from reportlab.platypus import Flowable

    original = Flowable.drawOn
    render.render(md.apply_md(None, long_doc()), draw=False)
    assert Flowable.drawOn is original
    with pytest.raises(RuntimeError):
        with render._no_drawing():
            assert Flowable.drawOn is not original
            raise RuntimeError
    assert Flowable.drawOn is original
    pdf, _ = render.render(md.apply_md(None, MD))
    assert "굵게굵고취소다시굵게" in "".join(pages_text(pdf))


def test_core_layout_reuses_the_same_request():
    from mditor import core

    doc = md.apply_md(None, long_doc())
    core._LAYOUTS.clear()
    first = core.layout(doc, {"font_size": 11})
    first["total"] = -1  # 돌려준 값을 고쳐도 기억해 둔 값은 그대로다
    again = core.layout(doc, {"font_size": 11})
    assert again == render.render(doc, Options(font_size=11))[1] and again["total"] > 0
    assert len(core._LAYOUTS) == 1
    core.layout(doc, {"font_size": 12})
    assert len(core._LAYOUTS) == 2


# ───────── 표 칸 안의 그림 · 그림 폭 ─────────


def _png(w: int, h: int) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (w, h), "#336699").save(buf, "PNG")
    return buf.getvalue()


def test_cell_images_are_drawn_in_their_cells():
    """칸 안의 그림은 칸 폭에 대한 % 로 그려지고, 쪽 배치는 그림 바이트가 있을 때와 크기만 알 때가 같다."""
    doc = md.apply_md(None, "## 가\n\n| 사진 | 설명 |\n|:---:|---|\n| ![a](a.png){width=50%} | 글<br>![b](b.png) |\n")
    cell = doc["sections"][0]["blocks"][0]["rows"][0]
    assert cell == ["![a](a.png){width=50%}", "글![b](b.png)"]  # 그림 옆 줄바꿈은 뜻이 없어 버린다
    pdf, with_bytes = render.render(doc, images={"a.png": _png(400, 300), "b.png": _png(200, 100)})
    with_sizes = render.render(doc, image_sizes={"a.png": [400, 300], "b.png": [200, 100]})[1]
    assert with_bytes == with_sizes
    images = [x for page in PdfReader(io.BytesIO(pdf)).pages for x in page.images]
    assert len(images) == 2  # 칸 안의 그림 둘이 PDF 에 들어갔다(같은 그림이면 PDF 가 하나로 합친다 — 그래서 다른 그림으로)
    assert "글" in "".join(pages_text(pdf))


def test_image_width_scales_the_figure():
    """그림 폭(%)은 본문 폭에 대한 비율이다 — 폭을 줄이면 높이도 줄어 쪽이 덜 찬다."""
    big = "\n\n".join(f"문단 {i}" for i in range(1, 30))
    narrow = md.apply_md(None, f"## 가\n\n![a](a.png){{width=20%}}\n\n{big}\n")
    wide = md.apply_md(None, f"## 가\n\n![a](a.png){{width=100%}}\n\n{big}\n")
    sizes = {"a.png": [800, 600]}
    assert render.render(wide, image_sizes=sizes)[1]["total"] >= render.render(narrow, image_sizes=sizes)[1]["total"]
    assert md.doc_md(wide).count("{width=100%}") == 1 and wide["sections"][0]["blocks"][0]["width"] == 100


def test_image_sources_include_table_cells():
    from mditor import images

    doc = md.apply_md(None, "![a](/i/" + "a" * 32 + "-10x20.png)\n\n| x |\n|---|\n| ![b](/i/" + "b" * 32 + "-30x40.png){width=40%} |\n")
    assert images.sources(doc) == ["/i/" + "a" * 32 + "-10x20.png", "/i/" + "b" * 32 + "-30x40.png"]
    assert images.sizes(doc) == {"/i/" + "a" * 32 + "-10x20.png": [10, 20], "/i/" + "b" * 32 + "-30x40.png": [30, 40]}

