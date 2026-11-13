import random

import pytest

from mditor import inline
from mditor.inline import Seg

from .synthetic import INLINE


def segs(s: str) -> list[dict]:
    return [x.to_json() for x in inline.normalize(inline.segments(s))]


def test_basic_marks():
    assert segs("**굵게** 보통 ~~취소~~") == [
        {"text": "굵게", "bold": True},
        {"text": " 보통 "},
        {"text": "취소", "strike": True},
    ]


def test_unpaired_stay_literal():
    assert segs("각주 1.31** 그대로") == [{"text": "각주 1.31** 그대로"}]
    assert segs("** 글** 짝 아님") == [{"text": "** 글** 짝 아님"}]
    assert inline.canon("각주 1.31** 그대로") == "각주 1.31** 그대로"  # 필요 없는 이스케이프는 하지 않는다


def test_tags_and_break():
    assert segs("{빨강}빨{/빨강}{밑줄}밑{/밑줄}{음영}음{/음영}a<br>b") == [
        {"text": "빨", "color": "빨강"},
        {"text": "밑", "underline": True},
        {"text": "음", "shade": True},
        {"text": "a\nb"},
    ]
    assert segs("{빨강}안 닫힘") == [{"text": "{빨강}안 닫힘"}]
    assert inline.canon("{빨강}안 닫힘") == r"\{빨강}안 닫힘"


def test_escape():
    assert segs(r"\*\*별\*\* \{빨강} \<br>") == [{"text": "**별** {빨강} <br>"}]
    assert inline.canon("<", "cell") == r"\<"
    assert inline.canon("^", "cell") == r"\^"
    assert inline.canon("- 항목", "para") == r"\- 항목"
    assert inline.canon("# 제목", "para") == r"\# 제목"
    assert inline.canon("#해시", "para") == "#해시"


def test_space_pushed_out():
    # 굵게 구간의 앞뒤 공백은 구간 밖으로 — 안 그러면 ``** 글**`` 이 되어 짝이 안 맞는다
    s = [Seg("보통"), Seg(" 굵게 ", bold=True), Seg("보통")]
    assert inline.write(inline.normalize(s)) == "보통 **굵게** 보통"
    s = [Seg("a ", strike=True), Seg("b", bold=True, strike=True)]
    assert inline.write(inline.normalize(s)) == "~~a~~ **~~b~~**"


def test_cell_shade():
    assert inline.cell_shade("{음영}칸{/음영}") == (True, "칸")
    assert inline.cell_shade("{음영}앞{/음영} 뒤 {음영}또{/음영}") == (False, "{음영}앞{/음영} 뒤 {음영}또{/음영}")
    assert inline.cell_shade("{음영}{/음영}") == (True, "")
    assert inline.cell_shade("보통") == (False, "보통")


def test_hex_colors():
    segs = inline.segments("앞 {#1F8A5C}초록{/#1f8a5c} {red}빨{/red}")
    assert [s.color for s in segs] == [None, "#1f8a5c", None, "빨강"]
    assert inline.canon("{#1F8A5C}초록{/#1F8A5C}") == "{#1f8a5c}초록{/#1f8a5c}"  # 소문자로 쓴다
    assert inline.write(inline.normalize(segs), dialect="en") == "앞 {#1f8a5c}초록{/#1f8a5c} {red}빨{/red}"  # 언어가 없다
    assert inline.dialect_of("{#123456}a{/#123456} {red}b{/red}") == "en"  # 색 코드는 태그 언어를 정하지 않는다
    assert inline.dialect_of("{#123456}a{/#123456}") is None
    assert inline.segments("{#12345}x{/#12345}")[0].color is None  # 여섯 자리만
    assert inline.canon(r"\{#abcdef} 글자") == r"\{#abcdef} 글자"
    assert '<font color="#1f8a5c">' in inline.rl_markup("{#1f8a5c}초록{/#1f8a5c}")


@pytest.mark.parametrize("s", INLINE)
def test_canon_is_stable(s):
    for ctx in (None, "cell", "para", "item"):
        once = inline.canon(s, ctx)
        assert inline.canon(once, ctx) == once
        assert inline.normalize(inline.segments(once)) == inline.normalize(inline.segments(s))


def test_random_roundtrip():
    rnd = random.Random(20261113)
    alphabet = ["가", "나", " ", " ", "*", "~", "{", "}", "\\", "<", "br>", "{빨강}", "{/밑줄}", "\n", "a", "|", "^", "-", "#"]
    for _ in range(3000):
        raw = [
            Seg(
                "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 5))),
                rnd.random() < 0.4, rnd.random() < 0.4, rnd.random() < 0.3, rnd.random() < 0.3,
                rnd.choice([None, None, "빨강", "파랑"]),
            )
            for _ in range(rnd.randint(1, 5))
        ]
        norm = inline.normalize(raw)
        for ctx in (None, "cell", "para", "item"):
            s = inline.write(norm, ctx)
            assert inline.normalize(inline.segments(s)) == norm, s
            assert inline.canon(s, ctx) == s


def test_rl_markup():
    out = inline.rl_markup("**a<b** {빨강}c{/빨강}<br>d")
    assert out == '<b>a&lt;b</b> <font color="#c00000">c</font><br/>d'
