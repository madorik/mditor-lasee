"""글 서식 규칙.

web/src/lib/inline.ts 와 **같은 규칙**이다. 고치면 둘 다 고친다(공유 기준 파일 tests/test_fixture.py 가 잡는다).

읽기  segments(s)  : 서식 문자열 → 조각(글자 + 굵게·취소선·밑줄·음영·색)
쓰기  write(segs)  : 조각 → 서식 문자열(표준 꼴 하나)
canon(s) = write(normalize(segments(s)))  — 저장하는 문자열은 언제나 이 꼴이다.

규칙
- ``**굵게**`` ``~~취소선~~`` : 여는 기호 **뒤**와 닫는 기호 **앞**이 공백이 아니어야 짝이 된다.
  짝 없는 기호는 글자 그대로 둔다(각주 ``1.31**``).
- ``{빨강}…{/빨강}`` ``{파랑}`` ``{회색}`` ``{밑줄}`` ``{음영}`` : 종류별로 여닫는 짝을 센다. 짝 없는 태그는 글자.
- ``<br>`` : 줄바꿈.
- ``\\`` 뒤의 ``\\ * ~ { } < > ^ | # - + !`` 는 글자 그대로(이스케이프).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace

COLORS = {"빨강": "#c00000", "파랑": "#1f4e9b", "회색": "#7f7f7f"}
SHADE = "#d9d9d9"
FLAGS = ("밑줄", "음영")
WS = " \t 　"
ESCAPABLE = "\\*~{}<>^|#-+!"

_TAG_NAMES = "|".join([*COLORS, *FLAGS])
_TOKEN = re.compile(
    r"\\([\\*~{}<>^|#\-+!])"  # 1: 이스케이프
    r"|(\*\*)"  # 2
    r"|(~~)"  # 3
    r"|\{(/?)(" + _TAG_NAMES + r")\}"  # 4: 닫힘 여부, 5: 이름
    r"|(<br[ \t]*/?>)",  # 6
    re.IGNORECASE,
)
_TAG_AT = re.compile(r"\{/?(?:" + _TAG_NAMES + r")\}")
_BR_AT = re.compile(r"<br[ \t]*/?>", re.IGNORECASE)
_RULE = re.compile(r"^([-*])(?:[ \t]*\1){2,}$")  # 가로줄(---)로 읽히는 문단
_ITEM_RULE = re.compile(r"^-(?:[ \t]*-)+$")  # "- " 뒤에 붙으면 가로줄이 되는 항목
_PARA_BLOCK = re.compile(r"^(?:#{1,6}(?:\s|$)|>|[-*+](?:\s|$)|\||!\[.*\]\(.*\)$)")


@dataclass(frozen=True)
class Seg:
    text: str
    bold: bool = False
    strike: bool = False
    underline: bool = False
    shade: bool = False
    color: str | None = None

    def style(self) -> tuple[bool, bool, bool, bool, str | None]:
        """바깥 → 안 순서(굵게 · 취소선 · 밑줄 · 음영 · 색)."""
        return (self.bold, self.strike, self.underline, self.shade, self.color)

    def to_json(self) -> dict:
        out: dict = {"text": self.text}
        for k in ("bold", "strike", "underline", "shade"):
            if getattr(self, k):
                out[k] = True
        if self.color:
            out["color"] = self.color
        return out


@dataclass
class _Tok:
    start: int
    end: int
    kind: str  # esc | bold | strike | open | close | br
    value: str = ""  # esc: 글자, open/close: 태그 이름
    paired: bool = False
    opens: bool = False  # bold/strike 가 짝일 때 여는 쪽인지
    partner: int = -1


def _scan(s: str) -> list[_Tok]:
    toks: list[_Tok] = []
    for m in _TOKEN.finditer(s):
        if m.group(1) is not None:
            toks.append(_Tok(m.start(), m.end(), "esc", m.group(1), True))
        elif m.group(2):
            toks.append(_Tok(m.start(), m.end(), "bold"))
        elif m.group(3):
            toks.append(_Tok(m.start(), m.end(), "strike"))
        elif m.group(5):
            toks.append(_Tok(m.start(), m.end(), "close" if m.group(4) else "open", m.group(5)))
        else:
            toks.append(_Tok(m.start(), m.end(), "br", "", True))

    # ** 와 ~~ : 가장 가까운 여는 기호와 짝짓는다
    for kind in ("bold", "strike"):
        pending = -1
        for i, t in enumerate(toks):
            if t.kind != kind:
                continue
            can_open = t.end < len(s) and s[t.end] not in WS
            can_close = t.start > 0 and s[t.start - 1] not in WS
            if pending >= 0 and can_close:
                o = toks[pending]
                o.paired = t.paired = True
                o.opens = True
                o.partner, t.partner = i, pending
                pending = -1
            elif can_open:
                pending = i

    # 중괄호 태그 : 종류별 스택
    stacks: dict[str, list[int]] = {}
    for i, t in enumerate(toks):
        if t.kind == "open":
            stacks.setdefault(t.value, []).append(i)
        elif t.kind == "close" and stacks.get(t.value):
            j = stacks[t.value].pop()
            toks[j].paired = t.paired = True
            toks[j].partner, t.partner = i, j
    return toks


def segments(s: str) -> list[Seg]:
    """서식 문자열 → 조각. 줄바꿈(<br>)은 글자 ``\\n`` 으로 들어간다."""
    toks = _scan(s)
    out: list[Seg] = []
    bold = strike = False
    depth = {name: 0 for name in FLAGS}
    colors: list[str] = []

    def emit(text: str) -> None:
        if not text:
            return
        seg = Seg(text, bold, strike, depth["밑줄"] > 0, depth["음영"] > 0, colors[-1] if colors else None)
        if out and out[-1].style() == seg.style():
            out[-1] = replace(out[-1], text=out[-1].text + text)
        else:
            out.append(seg)

    pos = 0
    for t in toks:
        emit(s[pos : t.start])
        pos = t.end
        if not t.paired:
            emit(s[t.start : t.end])
        elif t.kind == "esc":
            emit(t.value)
        elif t.kind == "br":
            emit("\n")
        elif t.kind == "bold":
            bold = t.opens
        elif t.kind == "strike":
            strike = t.opens
        elif t.value in COLORS:
            if t.kind == "open":
                colors.append(t.value)
            else:  # 가장 안쪽의 같은 색을 닫는다
                for k in range(len(colors) - 1, -1, -1):
                    if colors[k] == t.value:
                        del colors[k]
                        break
        else:
            depth[t.value] += 1 if t.kind == "open" else -1
    emit(s[pos:])
    return out


def _merge(segs: Iterable[Seg]) -> list[Seg]:
    out: list[Seg] = []
    for seg in segs:
        if not seg.text:
            continue
        if out and out[-1].style() == seg.style():
            out[-1] = replace(out[-1], text=out[-1].text + seg.text)
        else:
            out.append(seg)
    return out


def _trim_edges(segs: list[Seg], field: str, same: Callable[[Seg, Seg], bool]) -> list[Seg]:
    """``field`` 가 켜진 연속 구간마다 앞뒤 공백에서 그 서식을 뗀다(공백을 구간 밖으로 민다)."""
    out: list[Seg] = []
    i = 0
    while i < len(segs):
        if not getattr(segs[i], field):
            out.append(segs[i])
            i += 1
            continue
        j = i
        while j + 1 < len(segs) and getattr(segs[j + 1], field) and same(segs[i], segs[j + 1]):
            j += 1
        run = segs[i : j + 1]
        head: list[Seg] = []
        while run:  # 앞 공백
            t = run[0].text
            n = len(t) - len(t.lstrip(WS))
            if n == 0:
                break
            head.append(replace(run[0], text=t[:n], **{field: False}))
            if n == len(t):
                run = run[1:]
            else:
                run = [replace(run[0], text=t[n:]), *run[1:]]
                break
        tail: list[Seg] = []
        while run:  # 뒤 공백
            t = run[-1].text
            n = len(t) - len(t.rstrip(WS))
            if n == 0:
                break
            tail.insert(0, replace(run[-1], text=t[len(t) - n :], **{field: False}))
            if n == len(t):
                run = run[:-1]
            else:
                run = [*run[:-1], replace(run[-1], text=t[: len(t) - n])]
                break
        out += [*head, *run, *tail]
        i = j + 1
    return out


def normalize(segs: Iterable[Seg]) -> list[Seg]:
    """표준 꼴: 전체 앞뒤 공백·줄바꿈을 버리고, 굵게·취소선 구간의 앞뒤 공백을 구간 밖으로 민다."""
    cur = _merge(segs)
    while cur:
        t = cur[0].text.lstrip(WS + "\n")
        if t:
            cur[0] = replace(cur[0], text=t)
            break
        cur.pop(0)
    while cur:
        t = cur[-1].text.rstrip(WS + "\n")
        if t:
            cur[-1] = replace(cur[-1], text=t)
            break
        cur.pop()
    cur = _merge(_trim_edges(cur, "bold", lambda a, b: True))
    # 취소선은 굵게 안쪽이라 굵게가 바뀌는 자리에서 한 번 닫혔다 열린다 — 그 조각 단위로 민다
    cur = _merge(_trim_edges(cur, "strike", lambda a, b: a.bold == b.bold))
    return cur


def _open(level: int, value: object) -> str:
    return ("**", "~~", "{밑줄}", "{음영}", f"{{{value}}}")[level]


def _close(level: int, value: object) -> str:
    return ("**", "~~", "{/밑줄}", "{/음영}", f"{{/{value}}}")[level]


def write(segs: Iterable[Seg], ctx: str | None = None) -> str:
    """조각 → 서식 문자열. ``segs`` 는 normalize 를 거친 것이어야 한다.

    ctx="cell": 칸 전체가 ``<`` · ``^`` 하나면 이스케이프(칸 합치기 기호와 구별).
    ctx="para": 문단이 블록 기호(#, >, -, |, 그림)로 시작하거나 가로줄(---)로 읽히면 이스케이프.
    ctx="item": 항목이 ``- `` 뒤에 붙어 가로줄로 읽히면 이스케이프.
    """
    pieces: list[tuple[bool, str]] = []  # (기호인지, 글자)
    cur: tuple = (False, False, False, False, None)
    off: tuple = (False, False, False, False, None)
    for style, text in [*((s.style(), s.text) for s in segs), (off, "")]:
        first = next((i for i in range(5) if cur[i] != style[i]), None)
        if first is not None:
            for j in range(4, first - 1, -1):
                if cur[j]:
                    pieces.append((True, _close(j, cur[j])))
            for j in range(first, 5):
                if style[j]:
                    pieces.append((True, _open(j, style[j])))
        if text:
            pieces.append((False, text))
        cur = style

    raw = "".join(t for _, t in pieces)
    markup: list[bool] = []  # raw 의 글자마다: 우리가 넣은 기호인가
    token_at: set[int] = set()  # 우리가 넣은 ** · ~~ 의 시작 자리
    for is_markup, text in pieces:
        if is_markup and text in ("**", "~~"):
            token_at.add(len(markup))
        markup += [is_markup] * len(text)

    # 이스케이프할 자리(raw 기준). 꼭 필요한 곳만 — 짝 없는 ``1.31**`` 은 그대로 남는다.
    esc: set[int] = set()
    for p, ch in enumerate(raw):
        if markup[p]:
            continue
        if ch == "\\":
            if p + 1 < len(raw) and (raw[p + 1] in ESCAPABLE or raw[p + 1] == "\n"):
                esc.add(p)
        elif (ch == "{" and _TAG_AT.match(raw, p)) or (ch == "<" and _BR_AT.match(raw, p)):
            esc.add(p)

    while True:
        chars: list[str] = []
        origin: list[int] = []  # 출력 글자 → raw 자리
        for p, ch in enumerate(raw):
            if p in esc:
                chars.append("\\")
                origin.append(-1)
            if ch == "\n" and not markup[p]:
                chars += "<br>"
                origin += [-1] * 4
            else:
                chars.append(ch)
                origin.append(p)
        result = "".join(chars)
        # 글자로 쓴 * · ~ 가 서식 기호로 읽히면 그 자리만 이스케이프하고 다시 본다
        offender: list[int] = []
        for t in _scan(result):
            if t.kind not in ("bold", "strike"):
                continue
            p0, p1 = origin[t.start], origin[t.start + 1]
            if p0 in token_at:
                continue  # 우리가 넣은 기호가 제자리에서 읽혔다
            literal = [p for p in (p0, p1) if not markup[p]]
            if len(literal) < 2 or t.paired:
                offender = literal
                break
        if not offender:
            break
        esc.update(offender)

    if ctx == "cell" and result in ("<", "^"):
        return "\\" + result
    if ctx == "para" and (_PARA_BLOCK.match(result) or _RULE.match(result)):
        return "\\" + result
    if ctx == "item" and _ITEM_RULE.match(result):
        return "\\" + result
    return result


def canon(s: str, ctx: str | None = None) -> str:
    """서식 문자열을 표준 꼴로."""
    return write(normalize(segments(s)), ctx)


def plain(s: str) -> str:
    """서식을 뗀 글자만(줄바꿈은 공백)."""
    return " ".join("".join(seg.text for seg in segments(s)).split())


def cell_shade(s: str) -> tuple[bool, str]:
    """칸 전체를 ``{음영}…{/음영}`` 으로 감쌌으면 (True, 속 내용) — 칸 배경이다."""
    toks = _scan(s)
    if not toks:
        return False, s
    first, last = toks[0], toks[-1]
    whole = (
        first.start == 0
        and first.kind == "open"
        and first.value == "음영"
        and first.paired
        and last.end == len(s)
        and toks[first.partner] is last
    )
    return (True, s[first.end : last.start]) if whole else (False, s)


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rl_markup(s: str, wrap: Callable[[str], str] | None = None) -> str:
    """reportlab Paragraph 마크업. ``wrap`` 은 이스케이프된 글자를 받아 글꼴 대체 등을 입힌다."""
    out: list[str] = []
    for seg in segments(s):
        parts = []
        for i, line in enumerate(seg.text.split("\n")):
            if i:
                parts.append("<br/>")
            parts.append(wrap(line) if wrap else _xml(line))
        t = "".join(parts)
        if seg.color:
            t = f'<font color="{COLORS[seg.color]}">{t}</font>'
        if seg.shade:
            t = f'<font backColor="{SHADE}">{t}</font>'
        if seg.underline:
            t = f"<u>{t}</u>"
        if seg.strike:
            t = f"<strike>{t}</strike>"
        if seg.bold:
            t = f"<b>{t}</b>"
        out.append(t)
    return "".join(out)
