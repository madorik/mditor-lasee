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
        cell = ctx == "cell"  # 칸 문맥에서는 그림도 읽는다
        assert inline.normalize(inline.segments(once, cell)) == inline.normalize(inline.segments(s, cell))


def test_random_roundtrip():
    rnd = random.Random(20261113)
    alphabet = [
        "가", "나", " ", " ", "*", "~", "{", "}", "\\", "<", "br>", "{빨강}", "{/밑줄}", "\n", "a", "|", "^", "-", "#",
        "`", "[", "]", "(", ")", "=", ".", "_", "<sup>", "{가운데}", "1", "2",
        "](", "](a",
    ]
    for _ in range(3000):
        raw = [
            Seg(
                "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 5))),
                rnd.random() < 0.4, rnd.random() < 0.4, rnd.random() < 0.3, rnd.random() < 0.3,
                rnd.choice([None, None, "빨강", "파랑"]),
                rnd.random() < 0.3,
                link=rnd.choice([None, None, None, None, "u", "https://x.y/(a)", "a b"]),
                mark=rnd.random() < 0.2,
                script=rnd.choice([None, None, None, None, None, "sup", "sub"]),
                code=rnd.random() < 0.15,
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


def test_links():
    assert [x.to_json() for x in inline.segments("[a **b**](u) c")] == [
        {"text": "a ", "link": "u"},
        {"text": "b", "link": "u", "bold": True},
        {"text": " c"},
    ]
    assert inline.canon("**a [b](u) c**") == "**a** [**b**](u) **c**"  # 링크가 가장 바깥이다
    assert inline.canon("[a [b] c](u)") == "[a \\[b\\] c](u)"  # 링크 글 안의 대괄호는 언제나 이스케이프
    assert inline.canon("[x](a b)") == "[x](a b)"  # 빈칸이 든 주소는 링크가 아니다
    assert inline.canon("[x]()") == "[x]()" and inline.segments("[x]()") == [Seg("[x]()")]
    assert inline.canon("\\[a](u)") == "\\[a](u)"
    assert [(x.text, x.link) for x in inline.segments("[a [b](u) c](v)") if x.link] == [("b", "u")]  # 링크 안에 링크는 없다
    assert [x.link for x in inline.segments("[a](http://x.y/((a)))")] == [None]  # 괄호는 한 겹까지만
    assert [x.link for x in inline.segments("[a](http://x.y/a(b)c)")] == ["http://x.y/a(b)c"]
    # 주소를 쓸 때: 공백 · 짝 안 맞는 괄호는 퍼센트 부호로, 안 그래도 되는 주소는 그대로
    assert inline.write([Seg("x", link="a b(c")]) == "[x](a%20b%28c)"
    assert inline.write([Seg("x", link="https://x.y/(a)")]) == "[x](https://x.y/(a))"
    assert inline.link_href("가 나") == "가%20나"  # 글자는 그대로, 빈칸만 바꾼다
    assert inline.link_href("a\u3000b") == "a%E3%80%80b"
    # 쓰고 다시 읽어도 같다(normalize 가 주소를 쓸 꼴로 먼저 바꾼다)
    for href in ("a b", "x(", "(", "https://x.y/(a)", " u "):
        norm = inline.normalize([Seg("t", link=href)])
        assert inline.normalize(inline.segments(inline.write(norm))) == norm
    assert inline.normalize([Seg("t", link="   ")]) == [Seg("t")]  # 빈 주소는 링크가 아니다
    # 글 속에 literal 로 쓴 [ 가 링크를 열려 하면 그 자리만 이스케이프한다
    assert inline.write([Seg("[x](u)")]) == "\\[x](u)"
    assert inline.write([Seg("[x] (u)")]) == "[x] (u)"
    assert inline.write([Seg("a"), Seg("b", link="u")]) == "a[b](u)"


def test_safe_href():
    assert inline.safe_href("https://a.b") == "https://a.b" and inline.safe_href("#자리") == "#자리"
    assert inline.safe_href("javascript:alert(1)") is None and inline.safe_href("JavaScript:x") is None
    assert inline.safe_href("mailto:a@b.c") == "mailto:a@b.c" and inline.safe_href("  ") is None
    assert inline.pdf_href("/relative") is None and inline.pdf_href("tel:+8212") == "tel:+8212"


def test_code_spans():
    assert [x.to_json() for x in inline.segments("a `b **c**` d")] == [{"text": "a "}, {"text": "b **c**", "code": True}, {"text": " d"}]
    assert inline.canon("` `` `") == "` `` `"  # 안의 백틱 수와 다른 울타리
    assert inline.write([Seg("a`b", code=True)]) == "``a`b``"
    assert inline.write([Seg("`x", code=True)]) == "`` `x ``"  # 백틱으로 시작하거나 끝나면 빈칸을 덧댄다
    assert inline.write([Seg(" x ", code=True)]) == "`  x  `" and inline.write([Seg(" ", code=True)]) == "` `"
    assert inline.write([Seg("a`b")]) == "a\\`b"  # 글자 백틱은 언제나 이스케이프
    assert inline.canon("`a") == "\\`a" and inline.canon("``a`") == "\\`\\`a\\`"  # 짝이 없으면 글자
    assert inline.segments("`` a ``")[0].text == "a" and inline.segments("`  a  `")[0].text == " a "
    assert inline.canon("**`x`**") == "**`x`**" and inline.canon(r"`\*`") == r"`\*`"  # 안은 그대로
    assert inline.normalize([Seg("a\nb", code=True)])[0].text == "a b"  # 코드 안의 줄바꿈은 빈칸


def test_mark_and_scripts():
    assert [x.to_json() for x in inline.segments("==a== b")] == [{"text": "a", "mark": True}, {"text": " b"}]
    assert inline.canon("== a ==") == "== a ==" and inline.canon("==a") == "==a"
    assert inline.write(inline.normalize([Seg(" a ", mark=True)])) == "==a=="
    assert inline.canon("a == b") == "a == b" and inline.canon("====") == ""
    assert [x.to_json() for x in inline.segments("H<sub>2</sub>O")] == [{"text": "H"}, {"text": "2", "script": "sub"}, {"text": "O"}]
    assert inline.segments("<SUP>a</Sub>") == [Seg("<SUP>a</Sub>")]  # 짝은 이름이 같아야 한다
    assert [x.script for x in inline.segments("<sup>a<sub>b</sub>c</sup>")] == ["sup", "sub", "sup"]  # 가장 안쪽이 이긴다
    assert inline.write([Seg("<sup>")]) == "\\<sup>" and inline.canon("\\<sup>x\\</sup>") == "\\<sup>x\\</sup>"
    assert inline.canon("==a== ~~b~~ **c**") == "==a== ~~b~~ **c**"


def test_alignment_tags_in_text_and_paragraphs():
    assert inline.segments("a {가운데}b{/가운데} c") == [Seg("a b c")]  # 글 안에서는 버린다
    assert inline.canon("{center}x{/center}") == "x"
    assert inline.canon("\\{가운데}x") == "\\{가운데}x" and inline.write([Seg("{left}")]) == "\\{left}"
    assert inline.block_align("{가운데}정렬{/가운데}") == ("center", "정렬", True)
    assert inline.block_align("{right}**a**{/오른쪽}") == ("right", "**a**", True)
    assert inline.block_align("{양쪽}x{/양쪽}") == ("justify", "x", True)
    assert inline.block_align("{왼쪽}x{/왼쪽}") == (None, "x", True)
    assert inline.block_align("a {가운데}b{/가운데}") == (None, "a {가운데}b{/가운데}", False)
    assert inline.block_align("{가운데}a{/가운데}{가운데}b{/가운데}") == (None, "{가운데}a{/가운데}{가운데}b{/가운데}", False)
    assert inline.block_align("{음영}x{/음영}") == (None, "{음영}x{/음영}", False)
    assert inline.dialect_of("{center}a{/center}") == "en" and inline.dialect_of("{가운데}a{/가운데}") == "ko"


def test_block_symbols_are_escaped_in_paragraphs_and_items():
    assert inline.canon("1. 개요", "para") == "1\\. 개요" and inline.canon("2026) 연도", "para") == "2026\\) 연도"
    assert inline.canon("1.31 배", "para") == "1.31 배" and inline.canon("1234567890. 열", "para") == "1234567890. 열"
    assert inline.canon("\u0661. 아랍 숫자", "para") == "\u0661. 아랍 숫자"  # 번호는 ASCII 숫자만
    assert inline.canon("<!-- pagebreak -->", "para") == "\\<!-- pagebreak -->" and inline.canon("___", "para") == "\\___"
    assert inline.canon("[ ] 칸", "item") == "\\[ ] 칸" and inline.canon("[x]", "item") == "\\[x]" and inline.canon("[x]y", "item") == "[x]y"
    assert inline.canon("[ ] 칸", "para") == "[ ] 칸"


def test_tag_names_match_only_ascii_letters_case_insensitively():
    assert inline.segments("<ſup>x</ſup>") == [Seg("<ſup>x</ſup>")]  # ſ 는 s 가 아니다(자바스크립트와 같다)
    assert inline.segments("{RED}x{/Red}")[0].color == "빨강" and inline.segments("{ＲED}x{/ＲED}")[0].color is None


def test_rl_markup_new_formats():
    assert inline.rl_markup("==a==") == f'<font backColor="{inline.MARK}">a</font>'
    assert inline.rl_markup("H<sub>2</sub>O x<sup>2</sup>") == "H<sub>2</sub>O x<super>2</super>"
    link = inline.rl_markup("[**a** b](https://x.y/?a=1&b=2)")
    assert link == f'<a href="https://x.y/?a=1&amp;b=2" color="{inline.LINK_COLOR}"><u><b>a</b> b</u></a>'  # 같은 링크는 하나로
    assert inline.rl_markup("[x](javascript:alert(1)) [y](/rel)") == "x y"  # 열 수 없는 주소는 글자만
    code = inline.rl_markup("`a<b  c`")
    assert 'name="Courier"' in code and "a&lt;b" in code and "\u00a0" in code and inline.CODE_BG in code
    assert inline.CODE_BG not in inline.rl_markup("==`a`==")  # 형광펜 안의 코드는 형광펜 바탕을 지키지 않는다
    mixed = inline.rl_markup("`한글 abc`", lambda s: f"[{s}]")
    assert "[한글]" in mixed and 'name="Courier"' in mixed  # 영문 · 기호가 아닌 글자는 본문 글꼴(wrap)로


def test_stray_link_close_never_swallows_our_markup():
    # 짝 없는 `](…)` 는 통째로 글자로 읽힌다 — 안에 우리가 쓴 서식 기호가 들면 `]` 를 이스케이프해 토큰을 깬다
    cases = {
        "](`)": "\\](\\`)",
        r"](\*)": r"\](\\*)",
        "x](a`b)": "x\\](a\\`b)",
    }
    for src, want in cases.items():
        assert inline.canon(src) == want and inline.canon(want) == want
    swallow = [Seg("](a", italic=True), Seg(")x", mark=True)]
    out = inline.write(inline.normalize(swallow))
    assert out == "{기울임}\\](a{/기울임}==)x=="
    assert inline.normalize(inline.segments(out)) == inline.normalize(swallow)
    both = [Seg("](a", italic=True), Seg("}}](a", mark=True)]
    out = inline.write(inline.normalize(both))
    assert inline.normalize(inline.segments(out)) == inline.normalize(both)
    br = [Seg("](a\nb)")]  # <br> 은 우리가 넣는 기호다
    out = inline.write(inline.normalize(br))
    assert out == "\\](a<br>b)" and inline.normalize(inline.segments(out)) == inline.normalize(br)
