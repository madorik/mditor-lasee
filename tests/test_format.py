"""기울임 · 제목 서식 · 문서 글꼴."""

import pytest

from mditor import inline, md, render
from mditor.render import Options

# ───────────── 기울임 ─────────────


def test_italic_tag_in_both_languages():
    ko = inline.segments("{기울임}a{/기울임} **{italic}b{/italic}**")
    assert [s.italic for s in ko] == [True, False, True] and ko[2].bold
    assert inline.canon("{italic}a{/기울임}") == "{기울임}a{/기울임}"
    assert inline.canon("{기울임}a{/기울임}", None, "en") == "{italic}a{/italic}"
    # 굵게 · 취소선 안쪽, 밑줄 · 음영 · 색 바깥쪽
    assert inline.canon("{빨강}{밑줄}{기울임}x{/기울임}{/밑줄}{/빨강}") == "{기울임}{밑줄}{빨강}x{/빨강}{/밑줄}{/기울임}"
    assert inline.rl_markup("{기울임}x{/기울임}") == "<i>x</i>"
    assert inline.write([inline.Seg("{기울임}글자{/기울임}")]) == "\\{기울임}글자\\{/기울임}"


# ───────────── 제목 서식 ─────────────


def test_title_canonical_form():
    assert inline.title("  **굵게**   보통  ") == "**굵게** 보통"
    assert inline.title("줄<br>바꿈") == "줄 바꿈"  # 제목은 한 줄
    assert inline.title("a {빨강} b{/빨강}") == "a {빨강}b{/빨강}"  # 이어진 빈칸은 조각을 넘어서도 하나
    assert inline.title("{red}x{/red}", "en") == "{red}x{/red}"
    assert inline.title("1.31** 각주") == "1.31** 각주"  # 짝 없는 기호는 글자


def test_headings_keep_formatting():
    text = "# **굵은** 문서\n\n## 1. {빨강}빨간{/빨강} 섹션\n\n### 블록 {기울임}제목{/기울임}\n- 항목\n"
    doc = md.parse(text)
    assert doc["title"] == "**굵은** 문서"
    assert doc["sections"][0]["title"] == "1. {빨강}빨간{/빨강} 섹션"
    assert doc["sections"][0]["blocks"][0]["title"] == "블록 {기울임}제목{/기울임}"
    assert md.doc_md(doc) == text
    assert md.outline(md.attach_ids(doc))[0]["blocks"][0]["label"] == "블록 제목"  # 요약에는 글자만
    pdf, layout = render.render(md.attach_ids(doc))
    assert pdf.startswith(b"%PDF") and layout["total"] == 1


def test_plain_headings_unchanged():
    text = "# 2026년 보고\n\n## 1. 요약\n\n### 한눈에 보기\n- 항목\n"
    assert md.doc_md(md.parse(text)) == text


# ───────────── 문서 글꼴 ─────────────


def test_font_option_is_validated():
    assert Options.from_json({"font": "nanum-myeongjo"}).font == "nanum-myeongjo"
    assert Options.from_json({"font": "Comic Sans"}).font == "pretendard"
    assert Options.from_json(None).font == "pretendard"


@pytest.mark.parametrize("font", list(render.FAMILIES))
def test_every_font_renders_with_italics_and_fallback(font):
    doc = md.apply_md(None, "# 제목 {기울임}기울임{/기울임}\n\n- **{기울임}굵은 기울임{/기울임}** 漢字 ※①\n")
    pdf, layout = render.render(doc, Options.from_json({"font": font}))
    assert pdf.startswith(b"%PDF") and layout["total"] == 1
    assert b"MDitorOblique" in pdf  # 기울임은 기울인 글꼴로
    if font != "pretendard":  # 이 글꼴에 없는 한자 · 기호는 기본 글꼴(Pretendard)로
        assert b"Pretendard" in pdf


def test_layout_follows_the_font():
    """쪽 배치는 고른 글꼴로 실제로 그린 결과다 — 글자 폭이 다르면 쪽 수도 달라진다."""
    sentence = "글꼴에 따라 줄 수가 달라지는 꽤 긴 문장을 여기에 적는다. Latin text widths differ a lot between fonts."
    long = "# 문서\n\n## 1. 섹션\n\n" + "\n".join(f"- 항목 {i}: {sentence}" for i in range(90)) + "\n"
    doc = md.apply_md(None, long)
    pages = {font: render.render(doc, Options.from_json({"font": font}))[1]["total"] for font in render.FAMILIES}
    assert len(set(pages.values())) > 1, pages
