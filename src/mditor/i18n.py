"""사람에게 보이는 서버 문구의 언어.

열쇠는 한국어 원문이다(gettext 와 같은 방식) — 코드에는 한국어를 그대로 쓰고 ``t()`` 로 감싼다.
다른 언어는 아래 사전에 원문 → 번역을 넣는다. 번역이 없으면 원문(한국어)이 나간다.

언어는 요청마다 정한다: API 는 ``Accept-Language`` 를 읽어 ``use(lang)`` 안에서 처리한다.
MCP 와 그 밖의 호출은 기본값(한국어)이다.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar

LANGS = ("ko", "en")
DEFAULT = "ko"

_current: ContextVar[str] = ContextVar("mditor_lang", default=DEFAULT)

EN: dict[str, str] = {
    # MD 읽기
    "{line}번째 줄: {message}": "Line {line}: {message}",
    "표에 구분선(|---|) 줄이 없습니다. 머리글 줄 바로 아래에 넣으세요.": (
        "The table has no separator row (|---|). Put it right below the header row."
    ),
    "구분선(|---|) 위에 머리글 줄이 없습니다.": "There is no header row above the separator row (|---|).",
    "표는 {max}칸까지 쓸 수 있습니다(지금 {width}칸).": "A table can have up to {max} columns (this one has {width}).",
    "이 줄은 {cells}칸인데 머리글은 {width}칸입니다.": "This row has {cells} cells but the header has {width}.",
    "(문서 전체)": "(whole document)",
    # 입력 한도
    "markdown 은 문자열이어야 합니다.": "markdown must be a string.",
    "문서가 너무 깁니다({length}자). {limit}자까지 다룰 수 있습니다.": (
        "The document is too long ({length} characters). The limit is {limit} characters."
    ),
    "그림이 너무 큽니다. 합쳐서 {mb}MB 까지 붙일 수 있습니다.": "The images are too large. You can attach up to {mb} MB in total.",
    "요청이 너무 큽니다.": "The request is too large.",
    "요청이 너무 잦습니다. 잠시 뒤에 다시 해 주세요.": "Too many requests. Please try again in a moment.",
    "링크가 만료되었습니다.": "This link has expired.",
    "찾을 수 없습니다.": "Not found.",
    # PDF
    "문서를 쪽에 배치하지 못했습니다. 한 쪽보다 큰 그림이나 표 머리글이 있는지 확인하세요.": (
        "The document could not be laid out on pages. Check for an image or table header taller than a page."
    ),
    # AI
    "AI 수정이 꺼져 있습니다.": "Revise with AI is turned off.",
    "AI 수정은 하루 {n}번까지 쓸 수 있습니다.": "You can use Revise with AI up to {n} times a day.",
    "AI 수정은 {limit}자까지의 문서에 쓸 수 있습니다.": "Revise with AI works on documents up to {limit} characters.",
    "무엇을 고칠지 적어 주세요.": "Please describe what to change.",
    "AI 사용량이 몰렸습니다. 잠시 뒤에 다시 해 주세요.": "The AI is busy right now. Please try again in a moment.",
    "AI 호출에 실패했습니다({status}).": "The AI request failed ({status}).",
    "AI 서버에 연결하지 못했습니다.": "Could not reach the AI server.",
    "AI 가 이 요청을 처리하지 않았습니다. 지시를 바꿔 다시 해 보세요.": (
        "The AI declined this request. Try rephrasing your instructions."
    ),
    "문서가 길어 끝까지 고치지 못했습니다. 섹션을 나눠 요청해 보세요.": (
        "The document was too long to finish. Try asking for one section at a time."
    ),
    "AI 가 돌려준 글을 읽지 못했습니다({line}번째 줄: {message}). 다시 해 보세요.": (
        "Could not read the AI's reply (line {line}: {message}). Please try again."
    ),
}

CATALOGS: dict[str, dict[str, str]] = {"en": EN}


def lang() -> str:
    return _current.get()


@contextlib.contextmanager
def use(value: str | None) -> Iterator[str]:
    """이 안에서 만드는 문구는 ``value`` 언어로 나온다."""
    token = _current.set(value if value in LANGS else DEFAULT)
    try:
        yield _current.get()
    finally:
        _current.reset(token)


def pick(accept_language: str | None) -> str:
    """``Accept-Language`` → 우리가 아는 언어 하나(q 값 순서). 모르면 기본값."""
    if not accept_language:
        return DEFAULT
    ranked: list[tuple[float, int, str]] = []
    for i, part in enumerate(accept_language.split(",")):
        name, _, params = part.strip().partition(";")
        q = 1.0
        if params.strip().startswith("q="):
            try:
                q = float(params.strip()[2:])
            except ValueError:
                q = 0.0
        ranked.append((-q, i, name.strip().lower().split("-")[0]))
    for _, _, name in sorted(ranked):
        if name in LANGS:
            return name
    return DEFAULT


def t(source: str, **values: object) -> str:
    """한국어 원문 → 지금 언어의 문구. ``{이름}`` 자리에 values 를 넣는다."""
    text = CATALOGS.get(lang(), {}).get(source, source)
    return text.format(**values) if values else text
