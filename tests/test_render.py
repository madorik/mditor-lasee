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
