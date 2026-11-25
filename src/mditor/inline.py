"""글 서식 규칙.

web/packages/lasee-mditor/src/core/inline.ts 와 **같은 규칙**이다(화면 쪽이 기준 구현이다). 고치면 둘 다 고친다
(공유 기준 파일 tests/test_fixture.py 가 잡는다).

읽기  segments(s)  : 서식 문자열 → 조각(글자 + 링크·굵게·취소선·기울임·밑줄·음영·형광펜·색·첨자·코드)
쓰기  write(segs)  : 조각 → 서식 문자열(표준 꼴 하나)
canon(s) = write(normalize(segments(s)))  — 저장하는 문자열은 언제나 이 꼴이다.

서식(바깥 → 안 순서)
- ``[글](주소)`` : 링크. 글 안에 서식을 쓴다. 링크 안에 링크는 없다. 주소는 공백 · 제어 문자 · 괄호가 아닌 글자
  (괄호는 한 겹까지 짝을 맞춰 쓴다)이고 비어 있으면 링크가 아니다. 대괄호는 스택으로 짝을 맞춘다.
- ``**굵게**`` ``~~취소선~~`` ``==형광펜==`` : 여는 기호 **뒤**와 닫는 기호 **앞**이 공백이 아니어야 짝이 된다.
  짝 없는 기호는 글자 그대로 둔다(각주 ``1.31**``).
- ``{빨강}…{/빨강}`` ``{파랑}`` ``{회색}`` ``{기울임}`` ``{밑줄}`` ``{음영}`` : 종류별로 여닫는 짝을 센다. 짝 없는 태그는 글자.
  영어 이름 ``{red}`` ``{blue}`` ``{gray}`` ``{italic}`` ``{underline}`` ``{shade}`` 도 같은 태그다(대소문자 무시, ``{grey}`` 도 회색).
- ``{#1f8a5c}…{/#1f8a5c}`` : 색 코드(16진 여섯 자리)로 아무 글자 색이나 쓴다. 언어가 없는 태그라 태그 언어를 정하지 않고,
  쓸 때는 소문자로 쓴다.
- ``<sup>…</sup>`` ``<sub>…</sub>`` : 위 · 아래 첨자(대소문자 무시, 가장 안쪽이 이긴다).
- ```코드``` : 안의 글자는 그대로(서식 · 이스케이프 없음). 백틱 수가 같은 짝을 찾고, 짝이 없으면 백틱은 글자다.
- ``<br>`` : 줄바꿈.
- ``{왼쪽}`` ``{가운데}`` ``{오른쪽}`` ``{양쪽}`` : 문단 전체를 감쌀 때만 뜻이 있다(``block_align``). 글 안에서는 버린다.
- ``\\`` 뒤의 ``\\ * ~ { } < > ^ | # - + ! ` [ ] = . _ )`` 는 글자 그대로(이스케이프).

안에서는 한국어 태그 이름으로 다루고, 쓸 때만 문서의 태그 언어(dialect, ``ko`` | ``en``)로 쓴다.
문서의 태그 언어는 처음 나오는 짝 맞은 태그가 정한다(``dialect_of``). 태그가 없으면 부르는 쪽이 정한다.
"""

from __future__ import annotations

import functools
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace

COLORS = {"빨강": "#c00000", "파랑": "#1f4e9b", "회색": "#7f7f7f"}
SHADE = "#d9d9d9"
MARK = "#fff3a3"
CODE_BG = "#eef1f4"
LINK_COLOR = "#1f4e9b"
MONO = "Courier"  # PDF 의 코드 글꼴(PDF 기본 글꼴 — 영문 · 숫자 · 기호만 있다)
FLAGS = ("기울임", "밑줄", "음영")
DIALECTS = ("ko", "en")
EN = {
    "빨강": "red",
    "파랑": "blue",
    "회색": "gray",
    "기울임": "italic",
    "밑줄": "underline",
    "음영": "shade",
    "왼쪽": "left",
    "가운데": "center",
    "오른쪽": "right",
    "양쪽": "justify",
}
_ALIASES = {**{v: k for k, v in EN.items()}, "grey": "회색"}  # 영어 이름 → 안에서 쓰는 이름
ALIGN_TAGS: dict[str, str | None] = {"왼쪽": None, "가운데": "center", "오른쪽": "right", "양쪽": "justify"}
WS = " \t 　"
ESCAPABLE = "\\*~{}<>^|#-+!`[]=._)"

HEX = r"#[0-9a-fA-F]{6}"  # 색 코드 태그
_HEX_NAME = re.compile(r"^#[0-9a-f]{6}$")
_TAG_NAMES = "|".join([*EN, *_ALIASES, HEX])
# 링크 주소에 쓰는 글자 — 공백 · 제어 문자 · 괄호가 아닌 것. 괄호는 한 겹까지 짝을 맞춰 쓴다.
_URL_CHAR = r"[^\x00-\x20\x7f-\xa0  -     　﻿()]"
_URL = _URL_CHAR + r"*(?:\(" + _URL_CHAR + r"*\)" + _URL_CHAR + r"*)*"
_URL_WHOLE = re.compile(_URL)
_NEED_ENCODE = re.compile(r"[\x00-\x20\x7f-\xa0  -     　﻿()]")
# 영어 글자 대소문자만 무시한다(자바스크립트와 같게 — ſ 나 K(켈빈 기호)는 s · k 와 같지 않다)
_FLAGS_RE = re.IGNORECASE | re.ASCII
# 한 자리에서 읽는 토큰(이스케이프 · 코드는 따로 본다)
_AT = re.compile(
    r"(\*\*)|(~~)|(==)"  # 1 2 3
    r"|\{(/?)(" + _TAG_NAMES + r")\}"  # 4: 닫힘 여부, 5: 이름
    r"|(<br[ \t]*/?>)"  # 6
    r"|<(/?)(sup|sub)>"  # 7: 닫힘 여부, 8: 이름
    r"|(\[)"  # 9
    r"|\]\((" + _URL + r")\)"  # 10: 주소
    r"|(\])",  # 11
    _FLAGS_RE,
)
_TAG_AT = re.compile(r"\{/?(?:" + _TAG_NAMES + r")\}", _FLAGS_RE)
_BR_AT = re.compile(r"<br[ \t]*/?>", _FLAGS_RE)
_SCRIPT_AT = re.compile(r"</?(?:sup|sub)>", _FLAGS_RE)
_PAGEBREAK = re.compile(r"^<!--[ \t]*pagebreak[ \t]*-->\Z", _FLAGS_RE)
_RULE = re.compile(r"^([-*_])(?:[ \t]*\1){2,}\Z")  # 가로줄(---)로 읽히는 문단
_ITEM_RULE = re.compile(r"^-(?:[ \t]*-)+\Z")  # "- " 뒤에 붙으면 가로줄이 되는 항목
_ITEM_TASK = re.compile(r"^\[[ xX]\](?:\s|\Z)")  # 항목 글이 할 일 칸([ ])으로 읽힌다
_SPACES = re.compile(r"\s+")  # str.split() 과 같은 빈칸 문자(\x1c-\x1f 포함)
_PARA_BLOCK = re.compile(r"^(?:#{1,6}(?:\s|\Z)|>|[-*+](?:\s|\Z)|\||!\[.*\]\(.*\)\Z)")
_PARA_ORDERED = re.compile(r"^([0-9]{1,9})([.)])(?:\s|\Z)")  # \d 는 유니코드 숫자까지 잡는다 — 쓰지 않는다
_SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*):", re.IGNORECASE | re.ASCII)

# 0 링크 · 1 굵게 · 2 취소선 · 3 기울임 · 4 밑줄 · 5 음영 · 6 형광펜 · 7 색 · 8 첨자 · 9 코드
Style = tuple[str | None, bool, bool, bool, bool, bool, bool, str | None, str | None, bool]
OFF: Style = (None, False, False, False, False, False, False, None, None, False)
CODE = 9
_TAG_LEVEL = {3: "기울임", 4: "밑줄", 5: "음영"}


@dataclass(frozen=True)
class Seg:
    text: str
    bold: bool = False
    strike: bool = False
    underline: bool = False
    shade: bool = False
    color: str | None = None
    italic: bool = False
    link: str | None = None
    mark: bool = False
    script: str | None = None  # "sup" | "sub"
    code: bool = False

    def style(self) -> Style:
        """바깥 → 안 순서(링크 · 굵게 · 취소선 · 기울임 · 밑줄 · 음영 · 형광펜 · 색 · 첨자 · 코드). 빈 링크 · 색 · 첨자는 없는 것으로 본다."""
        return (
            self.link or None,
            bool(self.bold),
            bool(self.strike),
            bool(self.italic),
            bool(self.underline),
            bool(self.shade),
            bool(self.mark),
            self.color or None,
            self.script or None,
            bool(self.code),
        )

    def to_json(self) -> dict:
        out: dict = {"text": self.text}
        if self.link:
            out["link"] = self.link
        for k in ("bold", "strike", "italic", "underline", "shade", "mark"):
            if getattr(self, k):
                out[k] = True
        if self.color:
            out["color"] = self.color
        if self.script:
            out["script"] = self.script
        if self.code:
            out["code"] = True
        return out


def _seg(text: str, st: Style) -> Seg:
    return Seg(
        text, bold=st[1], strike=st[2], underline=st[4], shade=st[5], color=st[7], italic=st[3],
        link=st[0], mark=st[6], script=st[8], code=st[9],
    )


@dataclass
class _Tok:
    start: int
    end: int
    kind: str  # esc | bold | strike | mark | open | close | br | sopen | sclose | lopen | lclose | rclose | code
    # esc: 글자, open/close: 태그 이름(안에서 쓰는 한국어 이름), sopen/sclose: sup|sub, lopen/lclose: 주소, code: 속 글자
    value: str = ""
    paired: bool = False
    opens: bool = False  # bold/strike/mark 가 짝일 때 여는 쪽인지
    partner: int = -1
    raw: str = ""  # open/close: 글에 적힌 태그 이름 그대로
    active: bool = True  # lopen: 링크를 열 수 있는가(링크 안에 링크는 없다)


_PAIRED_DELIMS = ("bold", "strike", "mark")
_START = frozenset("\\`*~={<[]")  # 토큰의 첫 글자
_NEXT_START = re.compile(r"[\\`*~={<\[\]]")


def _scan(s: str) -> list[_Tok]:
    toks: list[_Tok] = []
    n = len(s)
    i = 0
    while i < n:
        ch = s[i]
        if ch not in _START:  # 토큰이 시작할 수 없는 글자는 건너뛴다(긴 글을 빨리 읽으려고)
            m = _NEXT_START.search(s, i)
            if not m:
                break
            i = m.start()
            ch = s[i]
        if ch == "\\" and i + 1 < n and s[i + 1] in ESCAPABLE:
            toks.append(_Tok(i, i + 2, "esc", s[i + 1], True))
            i += 2
            continue
        if ch == "`":  # 코드: 같은 수의 백틱으로 닫는다. 닫는 짝이 없으면 백틱은 글자다
            j = i
            while j < n and s[j] == "`":
                j += 1
            size = j - i
            k = j
            close = -1
            while k < n:
                if s[k] == "`":
                    m = k
                    while m < n and s[m] == "`":
                        m += 1
                    if m - k == size:
                        close = k
                        break
                    k = m
                else:
                    k += 1
            if close >= 0:
                body = s[j:close]
                if len(body) >= 2 and body[0] == " " and body[-1] == " " and body.strip(" "):
                    body = body[1:-1]
                toks.append(_Tok(i, close + size, "code", body, True))
                i = close + size
            else:
                i = j
            continue
        m = _AT.match(s, i)
        if not m:
            i += 1
            continue
        end = m.end()
        if m.group(1):
            toks.append(_Tok(i, end, "bold"))
        elif m.group(2):
            toks.append(_Tok(i, end, "strike"))
        elif m.group(3):
            toks.append(_Tok(i, end, "mark"))
        elif m.group(5):
            raw = m.group(5)
            name = raw.lower() if raw.startswith("#") else _ALIASES.get(raw.lower(), raw)
            toks.append(_Tok(i, end, "close" if m.group(4) else "open", name, raw=raw))
        elif m.group(6):
            toks.append(_Tok(i, end, "br", "", True))
        elif m.group(8):
            toks.append(_Tok(i, end, "sclose" if m.group(7) else "sopen", m.group(8).lower()))
        elif m.group(9):
            toks.append(_Tok(i, end, "lopen"))
        elif m.group(10):
            toks.append(_Tok(i, end, "lclose", m.group(10)))
        else:
            toks.append(_Tok(i, i + 1, "rclose"))  # `]` 또는 주소가 빈 `]()` — 괄호는 글자로 남는다
            i += 1
            continue
        i = end

    # ** · ~~ · == : 가장 가까운 여는 기호와 짝짓는다
    for kind in _PAIRED_DELIMS:
        pending = -1
        for i, t in enumerate(toks):
            if t.kind != kind:
                continue
            can_open = t.end < n and s[t.end] not in WS
            can_close = t.start > 0 and s[t.start - 1] not in WS
            if pending >= 0 and can_close:
                o = toks[pending]
                o.paired = t.paired = True
                o.opens = True
                o.partner, t.partner = i, pending
                pending = -1
            elif can_open:
                pending = i

    # 중괄호 태그 · <sup> <sub> : 종류별 스택
    stacks: dict[str, list[int]] = {}
    for i, t in enumerate(toks):
        if t.kind in ("open", "sopen"):
            stacks.setdefault(t.kind + t.value, []).append(i)
        elif t.kind in ("close", "sclose"):
            key = ("open" if t.kind == "close" else "sopen") + t.value
            if not stacks.get(key):
                continue
            j = stacks[key].pop()
            toks[j].paired = t.paired = True
            toks[j].partner, t.partner = i, j

    # 링크: 대괄호 스택. 링크가 되면 그 앞의 여는 괄호는 더는 링크를 열지 못한다
    brackets: list[int] = []
    for i, t in enumerate(toks):
        if t.kind == "lopen":
            brackets.append(i)
        elif t.kind in ("lclose", "rclose"):
            if not brackets:
                continue
            j = brackets.pop()
            if t.kind == "lclose" and toks[j].active:
                toks[j].paired = t.paired = True
                toks[j].value = t.value
                toks[j].partner, t.partner = i, j
                for k in brackets:
                    toks[k].active = False
    return toks


def segments(s: str) -> list[Seg]:
    """서식 문자열 → 조각. 줄바꿈(<br>)은 글자 ``\\n`` 으로 들어간다."""
    toks = _scan(s)
    out: list[Seg] = []
    link: str | None = None
    bold = strike = mark = False
    depth = {name: 0 for name in FLAGS}
    colors: list[str] = []
    scripts: list[str] = []

    def emit(text: str, code: bool = False) -> None:
        if not text:
            return
        st: Style = (
            link, bold, strike, depth["기울임"] > 0, depth["밑줄"] > 0, depth["음영"] > 0, mark,
            colors[-1] if colors else None, scripts[-1] if scripts else None, code,
        )
        if out and out[-1].style() == st:
            out[-1] = replace(out[-1], text=out[-1].text + text)
        else:
            out.append(_seg(text, st))

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
        elif t.kind == "code":
            emit(t.value, True)
        elif t.kind == "bold":
            bold = t.opens
        elif t.kind == "strike":
            strike = t.opens
        elif t.kind == "mark":
            mark = t.opens
        elif t.kind == "lopen":
            link = t.value
        elif t.kind == "lclose":
            link = None
        elif t.kind == "sopen":
            scripts.append(t.value)
        elif t.kind == "sclose":
            for k in range(len(scripts) - 1, -1, -1):
                if scripts[k] == t.value:
                    del scripts[k]
                    break
        elif is_color(t.value):
            if t.kind == "open":
                colors.append(t.value)
            else:  # 가장 안쪽의 같은 색을 닫는다
                for k in range(len(colors) - 1, -1, -1):
                    if colors[k] == t.value:
                        del colors[k]
                        break
        elif t.value in FLAGS:
            depth[t.value] += 1 if t.kind == "open" else -1
        # 정렬 태그는 글 안에서는 뜻이 없다
    emit(s[pos:])
    return out


def _merge(segs: Iterable[Seg]) -> list[Seg]:
    out: list[Seg] = []
    for sg in segs:
        if not sg.text:
            continue
        if out and out[-1].style() == sg.style():
            out[-1] = replace(out[-1], text=out[-1].text + sg.text)
        else:
            out.append(_seg(sg.text, sg.style()))
    return out


def _trim_edges(segs: list[Seg], field: int) -> list[Seg]:
    """``field`` 서식이 켜진 연속 구간마다 앞뒤 공백에서 그 서식을 뗀다(공백을 구간 밖으로 민다).

    구간은 그보다 바깥 서식(0..field-1)이 바뀌는 자리에서 끊긴다 — 쓸 때 거기서 기호가 닫혔다 열리기 때문이다.
    """
    out: list[Seg] = []
    i = 0
    while i < len(segs):
        st = segs[i].style()
        if not st[field]:
            out.append(segs[i])
            i += 1
            continue
        j = i
        while j + 1 < len(segs):
            nxt = segs[j + 1].style()
            if nxt[field] and st[:field] == nxt[:field]:
                j += 1
            else:
                break
        run = segs[i : j + 1]

        def off(sg: Seg, text: str, field: int = field) -> Seg:
            cut = list(sg.style())
            cut[field] = False
            return _seg(text, tuple(cut))  # type: ignore[arg-type]

        head: list[Seg] = []
        while run:  # 앞 공백
            t = run[0].text
            n = len(t) - len(t.lstrip(WS))
            if n == 0:
                break
            head.append(off(run[0], t[:n]))
            if n == len(t):
                run = run[1:]
            else:
                run = [_seg(t[n:], run[0].style()), *run[1:]]
                break
        tail: list[Seg] = []
        while run:  # 뒤 공백
            last = run[-1]
            t = last.text
            n = len(t) - len(t.rstrip(WS))
            if n == 0:
                break
            tail.insert(0, off(last, t[len(t) - n :]))
            if n == len(t):
                run = run[:-1]
            else:
                run = [*run[:-1], _seg(t[: len(t) - n], last.style())]
                break
        out += [*head, *run, *tail]
        i = j + 1
    return out


def normalize(segs: Iterable[Seg]) -> list[Seg]:
    """표준 꼴: 코드 안의 줄바꿈은 빈칸으로, 전체 앞뒤 공백·줄바꿈을 버리고,
    굵게·취소선·형광펜 구간의 앞뒤 공백을 구간 밖으로 민다(짝 규칙 때문에 기호 안쪽에 공백을 둘 수 없다)."""
    pre: list[Seg] = []
    for sg in segs:  # 코드 안의 줄바꿈은 빈칸, 링크 주소는 MD 에 쓸 꼴(link_href)로 — 그래야 쓰고 다시 읽어도 같다
        st = list(sg.style())
        text = sg.text.replace("\n", " ") if st[CODE] and "\n" in sg.text else sg.text
        if st[0]:
            st[0] = link_href(st[0]) or None
        pre.append(_seg(text, tuple(st)))  # type: ignore[arg-type]
    cur = _merge(pre)
    while cur:
        t = cur[0].text.lstrip(WS + "\n")
        if t:
            cur[0] = _seg(t, cur[0].style())
            break
        cur.pop(0)
    while cur:
        t = cur[-1].text.rstrip(WS + "\n")
        if t:
            cur[-1] = _seg(t, cur[-1].style())
            break
        cur.pop()
    for field in (1, 2, 6):
        cur = _merge(_trim_edges(cur, field))
    return cur


def is_color(name: str) -> bool:
    """글자 색 태그인가 — 이름 붙은 색(빨강 · 파랑 · 회색) 또는 색 코드(#rrggbb)."""
    return name in COLORS or bool(_HEX_NAME.match(name))


def color_css(name: str) -> str:
    """글자 색 태그 → 색 코드."""
    return COLORS.get(name, name)


def tag(name: str, dialect: str = "ko") -> str:
    """태그 이름을 문서의 태그 언어로(``tag("음영", "en") == "shade"``). 색 코드는 그대로."""
    return EN.get(name, name) if dialect == "en" else name


def _open(level: int, value: object, dialect: str) -> str:
    if level == 0:
        return "["
    if level == 1:
        return "**"
    if level == 2:
        return "~~"
    if level == 6:
        return "=="
    if level == 8:
        return f"<{value}>"
    return "{" + tag(_TAG_LEVEL.get(level) or str(value), dialect) + "}"


def _close(level: int, value: object, dialect: str) -> str:
    if level == 0:
        return f"]({link_href(str(value))})"
    if level == 1:
        return "**"
    if level == 2:
        return "~~"
    if level == 6:
        return "=="
    if level == 8:
        return f"</{value}>"
    return "{/" + tag(_TAG_LEVEL.get(level) or str(value), dialect) + "}"


def link_href(href: str) -> str:
    """링크 주소를 MD 에 쓸 꼴로 — 공백이나 짝 안 맞는 괄호가 있으면 퍼센트 부호로 바꾼다."""
    h = href.strip()
    if h and _URL_WHOLE.fullmatch(h):
        return h
    return _NEED_ENCODE.sub(lambda m: "".join(f"%{b:02X}" for b in m.group(0).encode("utf-8")), h)


def safe_href(href: str) -> str | None:
    """링크 주소가 열어도 되는 것인가(javascript: 같은 것은 막는다). 상대 주소 · #자리는 그대로 돌려준다."""
    h = href.strip()
    if not h:
        return None
    m = _SCHEME.match(h)
    if not m:
        return h
    return h if m.group(1).lower() in ("http", "https", "mailto", "tel") else None


def pdf_href(href: str) -> str | None:
    """PDF 에 링크로 걸어도 되는 주소 — http · https · mailto · tel 만(상대 주소는 PDF 에서 갈 곳이 없다)."""
    h = safe_href(href)
    return h if h and _SCHEME.match(h) else None


def _code_span(text: str) -> str:
    """코드 조각 → `코드`. 안에 없는 길이의 백틱으로 감싸고, 끝이 백틱이거나 양끝이 빈칸이면 빈칸을 하나씩 덧댄다."""
    runs: set[int] = set()
    run = 0
    for ch in text + " ":
        if ch == "`":
            run += 1
        else:
            if run:
                runs.add(run)
            run = 0
    n = 1
    while n in runs:
        n += 1
    fence = "`" * n
    pad = (
        " "
        if text.startswith("`") or text.endswith("`") or (len(text) >= 2 and text[0] == " " and text[-1] == " " and text.strip(" "))
        else ""
    )
    return fence + pad + text + pad + fence


def dialect_of(text: str) -> str | None:
    """문서의 태그 언어 — 처음 나오는 짝 맞은 태그가 정한다. 태그가 없으면 None."""
    for line in text.split("\n"):
        if "{" not in line:
            continue
        for t in _scan(line):
            if t.kind == "open" and t.paired and not t.raw.startswith("#"):  # 색 코드는 언어가 없다
                return "en" if t.raw.lower() in _ALIASES else "ko"
    return None


def write(segs: Iterable[Seg], ctx: str | None = None, dialect: str = "ko") -> str:
    """조각 → 서식 문자열. ``segs`` 는 normalize 를 거친 것이어야 한다.

    ctx="cell": 칸 전체가 ``<`` · ``^`` 하나면 이스케이프(칸 합치기 기호와 구별).
    ctx="para": 문단이 블록 기호(#, >, -, |, 그림, 번호, 쪽 나눔)로 시작하거나 가로줄(---)로 읽히면 이스케이프.
    ctx="item": 항목이 ``- `` 뒤에 붙어 가로줄로 읽히거나 할 일 칸(``[ ]``)으로 시작하면 이스케이프.
    dialect: 태그를 쓸 언어(``ko`` | ``en``).
    """
    pieces: list[tuple[bool, str, bool]] = []  # (기호인지, 글자, 링크 안인지)
    cur: Style = OFF
    for st, text in [*((sg.style(), sg.text) for sg in segs), (OFF, "")]:
        first = next((i for i in range(CODE) if cur[i] != st[i]), None)
        if first is not None:
            for j in range(CODE - 1, first - 1, -1):
                if cur[j]:
                    pieces.append((True, _close(j, cur[j], dialect), False))
            for j in range(first, CODE):
                if st[j]:
                    pieces.append((True, _open(j, st[j], dialect), False))
        if text:
            pieces.append((True, _code_span(text), False) if st[CODE] else (False, text, bool(st[0])))
        cur = st

    raw = "".join(p[1] for p in pieces)
    markup: list[bool] = []  # raw 의 글자마다: 우리가 넣은 기호인가
    in_link: list[bool] = []
    token_at: set[int] = set()  # 우리가 넣은 ** · ~~ · == 의 시작 자리
    link_at: set[int] = set()  # 우리가 넣은 링크 여는 [ 자리
    for is_markup, text, linked in pieces:
        if is_markup and text in ("**", "~~", "=="):
            token_at.add(len(markup))
        if is_markup and text == "[":
            link_at.add(len(markup))
        markup += [is_markup] * len(text)
        in_link += [linked] * len(text)

    # 이스케이프할 자리(raw 기준). 꼭 필요한 곳만 — 짝 없는 ``1.31**`` 은 그대로 남는다.
    esc: set[int] = set()
    for p, ch in enumerate(raw):
        if markup[p]:
            continue
        if ch == "\\":
            if p + 1 < len(raw) and (raw[p + 1] in ESCAPABLE or raw[p + 1] == "\n"):
                esc.add(p)
        elif ch == "{":
            if _TAG_AT.match(raw, p):
                esc.add(p)
        elif ch == "<":
            if _BR_AT.match(raw, p) or _SCRIPT_AT.match(raw, p):
                esc.add(p)
        elif ch == "`":
            esc.add(p)  # 글자로 쓴 백틱은 언제나
        elif ch in "[]" and in_link[p]:
            esc.add(p)  # 링크 글 안의 대괄호는 언제나

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
        # 글자로 쓴 * · ~ · = 가 서식 기호로 읽히거나 글자로 쓴 [ 가 링크를 열면 그 자리만 이스케이프하고 다시 본다
        offender: list[int] = []
        for t in _scan(result):
            if t.kind in ("bold", "strike", "mark"):
                p0, p1 = origin[t.start], origin[t.start + 1]
                if p0 in token_at:
                    continue  # 우리가 넣은 기호가 제자리에서 읽혔다
                literal = [p for p in (p0, p1) if not markup[p]]
                if len(literal) < 2 or t.paired:
                    offender = literal
                    break
            elif t.kind == "lopen" and t.paired:
                p0 = origin[t.start]
                if p0 in link_at:
                    continue
                offender = [p0]
                break
            elif t.kind == "lclose" and not t.paired:
                # 짝 없는 `](…)` 는 통째로 글자로 읽힌다 — 그 안에 우리가 넣은 기호(서식 · <br> · 이스케이프)가 들면
                # 기호가 글자가 되어 버리므로, 글자로 쓴 `]` 를 이스케이프해 토큰을 깬다
                p0 = origin[t.start]
                swallows = any(origin[k] < 0 or markup[origin[k]] for k in range(t.start + 1, t.end))
                if p0 >= 0 and not markup[p0] and swallows:
                    offender = [p0]
                    break
        if not offender:
            break
        esc.update(offender)

    if ctx == "cell" and result in ("<", "^"):
        return "\\" + result
    if ctx == "para":
        if _PARA_BLOCK.match(result) or _RULE.match(result) or _PAGEBREAK.match(result):
            return "\\" + result
        m = _PARA_ORDERED.match(result)
        if m:
            return m.group(1) + "\\" + result[len(m.group(1)) :]
    if ctx == "item" and (_ITEM_RULE.match(result) or _ITEM_TASK.match(result)):
        return "\\" + result
    return result


def _canon(s: str, ctx: str | None, dialect: str) -> str:
    return write(normalize(segments(s)), ctx, dialect)


# 고치는 동안 문서의 대부분 줄은 그대로다 — 줄마다의 결과를 기억해 두면 다음 되읽기는 바뀐 줄만 계산한다.
# 큰 문서(40만 자 ≈ 3만 줄)가 통째로 들어가도록 넉넉히, 긴 줄은 담지 않아 메모리를 묶어 둔다(최악 수십 MB).
_canon_cached = functools.lru_cache(maxsize=32768)(_canon)
_CANON_CACHE_LEN = 400


def canon(s: str, ctx: str | None = None, dialect: str = "ko") -> str:
    """서식 문자열을 표준 꼴로."""
    if len(s) > _CANON_CACHE_LEN:
        return _canon(s, ctx, dialect)
    return _canon_cached(s, ctx, dialect)


def _one_space(segs: Iterable[Seg]) -> list[Seg]:
    """줄바꿈·빈칸 문자를 빈칸 하나로, 이어진 빈칸은 조각 경계를 넘어서도 하나로."""
    out: list[Seg] = []
    space = False  # 앞 조각이 빈칸으로 끝났는가
    for sg in segs:
        text = _SPACES.sub(" ", sg.text)
        if space and text.startswith(" "):
            text = text[1:]
        if text:
            out.append(_seg(text, sg.style()))
            space = text.endswith(" ")
    return out


def title(s: str, dialect: str = "ko") -> str:
    """제목(# ## ###)의 표준 꼴. 서식은 본문과 같고, 한 줄이므로 줄바꿈은 빈칸이며 이어진 빈칸은 하나다."""
    return write(normalize(_one_space(segments(s))), None, dialect)


def plain(s: str) -> str:
    """서식을 뗀 글자만(줄바꿈은 공백)."""
    return " ".join("".join(seg.text for seg in segments(s)).split())


def _wrapped(s: str, accept: Callable[[_Tok], bool]) -> tuple[str | None, str]:
    """글 전체를 한 태그로 감쌌으면 (태그 이름, 속 내용)."""
    toks = _scan(s)
    if not toks:
        return None, s
    first, last = toks[0], toks[-1]
    whole = (
        first.start == 0
        and first.kind == "open"
        and accept(first)
        and first.paired
        and last.end == len(s)
        and toks[first.partner] is last
    )
    return (first.value, s[first.end : last.start]) if whole else (None, s)


def cell_shade(s: str) -> tuple[bool, str]:
    """칸 전체를 ``{음영}…{/음영}`` 으로 감쌌으면 (True, 속 내용) — 칸 배경이다."""
    name, inner = _wrapped(s, lambda t: t.value == "음영")
    return name is not None, inner


def block_align(s: str) -> tuple[str | None, str, bool]:
    """문단 전체를 정렬 태그(``{가운데}…{/가운데}``)로 감쌌으면 (정렬, 속 내용, True). 왼쪽은 기본이라 정렬이 None."""
    name, inner = _wrapped(s, lambda t: t.value in ALIGN_TAGS)
    return (None, s, False) if name is None else (ALIGN_TAGS[name], inner, True)


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _attr(text: str) -> str:
    return _xml(text).replace('"', "&quot;")


_MONO_OK = re.compile(r"[ -~]+")  # PDF 기본 글꼴(Courier)에 있는 글자
_KEEP_SPACE = re.compile(r"(?<=\S) (?=\S)|( )")


def _mono_markup(text: str, wrap: Callable[[str], str] | None, bg: bool) -> str:
    """코드 글자 한 줄 → 마크업. 영문 · 숫자 · 기호는 Courier, 그 밖의 글자는 본문 글꼴(``wrap`` 이 글꼴 대체를 입힌다)."""
    out: list[str] = []
    pos = 0
    back = f' backColor="{CODE_BG}"' if bg else ""

    def other(run: str) -> None:
        inner = wrap(run) if wrap else _xml(run)
        out.append(f'<font backColor="{CODE_BG}">{inner}</font>' if bg else inner)

    for m in _MONO_OK.finditer(text):
        if m.start() > pos:
            other(text[pos : m.start()])
        run = _KEEP_SPACE.sub(lambda g: g.group(0) if g.group(1) is None else " ", m.group(0))
        out.append(f'<font name="{MONO}" size="-1"{back}>{_xml(run)}</font>')
        pos = m.end()
    if pos < len(text):
        other(text[pos:])
    return "".join(out)


def rl_markup(s: str, wrap: Callable[[str], str] | None = None) -> str:
    """reportlab Paragraph 마크업. ``wrap`` 은 이스케이프된 글자를 받아 글꼴 대체 등을 입힌다.

    링크는 http · https · mailto · tel 주소만 눌리는 링크(``<a>``)로 그린다 — 나머지는 링크 글만 보통 글자로 둔다.
    """
    out: list[str] = []
    href_of_last: str | None = None
    for seg in segments(s):
        parts = []
        for i, line in enumerate(seg.text.split("\n")):
            if i:
                parts.append("<br/>")
            if seg.code:
                parts.append(_mono_markup(line, wrap, not (seg.mark or seg.shade)))
            else:
                parts.append(wrap(line) if wrap else _xml(line))
        t = "".join(parts)
        if seg.script:
            name = "super" if seg.script == "sup" else "sub"
            t = f"<{name}>{t}</{name}>"
        if seg.color:
            t = f'<font color="{color_css(seg.color)}">{t}</font>'
        if seg.mark:
            t = f'<font backColor="{MARK}">{t}</font>'
        if seg.shade:
            t = f'<font backColor="{SHADE}">{t}</font>'
        if seg.underline:
            t = f"<u>{t}</u>"
        if seg.italic:
            t = f"<i>{t}</i>"
        if seg.strike:
            t = f"<strike>{t}</strike>"
        if seg.bold:
            t = f"<b>{t}</b>"
        href = pdf_href(seg.link) if seg.link else None
        if href and href == href_of_last:  # 같은 링크가 이어지면 하나로 묶는다
            out[-1] = out[-1][: -len("</u></a>")] + t + "</u></a>"
        elif href:
            out.append(f'<a href="{_attr(href)}" color="{LINK_COLOR}"><u>{t}</u></a>')
        else:
            out.append(t)
        href_of_last = href
    return "".join(out)
