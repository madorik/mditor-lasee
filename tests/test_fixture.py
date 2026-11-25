"""공유 기준 파일 — 서버가 만들고(여기), 화면 테스트(vitest)가 읽는다.

파일이 최신이 아니면 실패한다. 다시 만들려면:  MDITOR_WRITE_FIXTURE=1 uv run pytest tests/test_fixture.py
"""

import json
import os
import random
import re
from pathlib import Path

from mditor import inline, md, table
from mditor.inline import Seg
from mditor.settings import example_md

from .synthetic import INLINE, MD

PATH = Path(__file__).resolve().parents[1] / "web" / "packages" / "lasee-mditor" / "src" / "fixture.json"
CTX = (None, "cell", "para", "item")
EXAMPLE_EN = Path(__file__).resolve().parents[1] / "src" / "mditor" / "data" / "example.en.md"


def _to_en(text: str) -> str:
    """한국어 태그를 영어 태그로 바꾼 같은 문서."""
    return re.sub(
        r"\{(/?)(빨강|파랑|회색|기울임|밑줄|음영|왼쪽|가운데|오른쪽|양쪽)\}", lambda m: "{" + m.group(1) + inline.EN[m.group(2)] + "}", text
    )



def _json(segs):
    return [s.to_json() for s in segs]


# 블록 읽기 사례(화면의 parseMarkdown 이 같은 문서를 만드는지 본다). (MD, 부르는 쪽의 태그 언어)
PARSE: list[tuple[str, str | None]] = [
    # 번호 목록 · 할 일 · 단계
    ("1. a\n2. b\n3. c\n", None),
    ("1) a\n2) b\n", None),
    ("3. a\n4. b\n", None),
    ("0. a\n1. b\n", None),
    ("1. a\n1. b\n1. c\n", None),
    ("5. a\n9. b\n2. c\n", None),
    ("- a\n1. b\n2. c\n- d\n5. e\n", None),
    ("1. a\n   - b\n   - c\n2. d\n   - e\n3. f\n", None),
    ("- a\n  - b\n    - c\n      - d\n        - e\n", None),
    ("- a\n    - b\n        - c\n", None),
    ("- a\n - b\n  - c\n   - d\n", None),
    ("  - a\n- b\n", None),
    ("    - a\n  - b\n- c\n", None),
    ("- a\n\t- b\n\t\t- c\n", None),
    ("1. a\n   1. b\n   2. c\n2. d\n   1. e\n", None),
    ("1. a\n  1. b\n", None),
    ("10. a\n11. b\n    - c\n", None),
    ("9. a\n   10. b\n       - c\n   11. d\n", None),
    ("- a\n  1. b\n  2. c\n- d\n  7. e\n", None),
    ("- [ ] a\n- [x] b\n- [X] c\n- [ ]\n- [ ]x\n- [x]  spaced\n", None),
    ("1. [ ] a\n2. [x] b\n", None),
    ("- [ ]\n", None),
    ("-\n- a\n", None),
    ("1.\n2. a\n", None),
    ("-a\n", None),
    ("1.a\n", None),
    ("- a\n\n- b\n\n\n- c\n", None),
    ("- a\n> note\n- b\n", None),
    ("### T\n1. a\n2. b\n", None),
    ("* a\n+ b\n- c\n", None),
    ("- 1. a\n", None),
    ("- - a\n", None),
    ("- ---\n", None),
    ("- \\- -\n- \\[ ] x\n- [ ] \\[ ] y\n", None),
    ("1. 번호 1. 안\n", None),
    ("1234567890. a\n", None),
    ("١. a\n", None),
    ("２. a\n", None),
    ("1\\. a\n\n1\\) a\n\n2026\\. a\n", None),
    ("1.  두 칸 뒤\n", None),
    ("1.\ta\n", None),
    ("- a\n```\nc\n```\n- b\n", None),
    # 코드 블록
    ("```\ncode\n```\n", None),
    ("```py\nx = 1\n```\n", None),
    ("```py title=x\nx\n```\n", None),
    ("~~~\nx\n~~~\n", None),
    ("```\nunclosed\n", None),
    ("```\n## not heading\n# nor this\n```\n## real\n", None),
    ("````\n```\ninner\n```\n````\n", None),
    ("```\n````\n", None),
    ("``` a`b\n", None),
    ("  ```\n  indented\n    more\n```\n", None),
    ("    ```\ncode?\n```\n", None),
    ("```\n\n\ncode\n\n\n```\n", None),
    ("```\n```\n", None),
    ("### Title\n```js\nx\n```\n> note\n", None),
    ("text\n```\ncode\n```\nmore\n", None),
    ("```\n\tx\n```\n", None),
    ("```\nx\n```   \n", None),
    ("```\nx\n``` y\n```\n", None),
    ("```\n`a`\n``b``\n```\n", None),
    ("```\n  trailing  \n```\n", None),
    ("```\nwindows\r\nline\r\n```\r\n", None),
    ("# T\n\n## S\n\n```\n## in code\n```\n\n## S2\n", None),
    ("# T\n```\n# not title\n```\n", None),
    ("```\n# a\n```\n# T\n", None),
    ("text\n\n```\n## x\n", None),
    ("## A\n```\n## B\n```\n## C\n", None),
    ("### 제목\n```\n```\n```\n```\n", None),
    # 가로줄 · 쪽 나눔
    ("---\n", None),
    ("***\n", None),
    ("___\n", None),
    ("- - -\n", None),
    ("* * *\n", None),
    ("_ _ _\n", None),
    ("--\n", None),
    ("----------\n", None),
    ("a\n---\n", None),
    ("### T\n---\n> note\n", None),
    ("- a\n---\n- b\n", None),
    ("  ---  \n", None),
    ("<!-- pagebreak -->\n", None),
    ("<!--pagebreak-->\n", None),
    ("<!--  PageBreak  -->\n", None),
    ("<!-- pagebreak --> x\n", None),
    ("  <!-- pagebreak -->  \n", None),
    ("a\n<!-- pagebreak -->\nb\n", None),
    ("### T\n<!-- pagebreak -->\n", None),
    ("\\<!-- pagebreak -->\n", None),
    ("\\---\n\n\\___\n\n\\***\n", None),
    # 문단 정렬
    ("{가운데}a{/가운데}\n", None),
    ("{오른쪽}a{/오른쪽}\n", None),
    ("{양쪽}a{/양쪽}\n", None),
    ("{왼쪽}a{/왼쪽}\n", None),
    ("{center}a{/center}\n", None),
    ("{center}a{/center}\n", "ko"),
    ("{가운데}a{/가운데}\n", "en"),
    ("{right}a{/right}\n\n{가운데}b{/가운데}\n", None),
    ("{justify}a{/justify}\n", "ko"),
    ("{left}a{/left}\n", "en"),
    ("{가운데}{/가운데}\n", None),
    ("{가운데}a{/center}\n", None),
    ("{가운데}**a**{/가운데} tail\n", None),
    ("x {가운데}a{/가운데}\n", None),
    ("{가운데}a{/가운데}{가운데}b{/가운데}\n", None),
    ("{가운데}{오른쪽}a{/오른쪽}{/가운데}\n", None),
    ("{가운데}a\n", None),
    ("{가운데}[링크](u){/가운데}\n", None),
    ("{가운데}1. a{/가운데}\n", None),
    ("{가운데}# x{/가운데}\n", None),
    ("{가운데}`코드`{/가운데}\n", None),
    ("{음영}{가운데}x{/가운데}{/음영}\n", None),
    ("{가운데}{음영}x{/음영}{/가운데}\n", None),
    ("| {가운데}a{/가운데} |\n|---|\n", None),
    ("> {가운데}note{/가운데}\n", None),
    ("### {가운데}title{/가운데}\n", None),
    ("- {가운데}item{/가운데}\n", None),
    ("{가운데}a{/가운데}\n{red}b{/red}\n", None),
    ("{왼쪽}{/왼쪽}\n", None),
    ("{가운데} a {/가운데}\n", None),
    # 링크 · 코드 · 형광펜 · 첨자 — 제목 · 칸 · 비고 · 그림 설명
    ("# [t](u)\n\n## [a](u) `b`\n\ntext\n", None),
    ("### [a](u)\ntext\n", None),
    ("### `code` ==mark== H<sub>2</sub>O\ntext\n", None),
    ("| [a](u) | `b|c` |\n|---|---|\n| `x\\|y` | [z](u) |\n", None),
    ("| a | b |\n|---|---|\n| ==m== | x<sup>2</sup> |\n| {음영}[l](u){/음영} | {음영}`c`{/음영} |\n", None),
    ("| a | b |\n|---|---|\n| \\[x\\] | `a``b` |\n", None),
    ("> [a](u) `b`\n> ==c== d<sup>e</sup>\n", None),
    ("![a [b](u) `c`](img.png)\n", None),
    ("![](a(b).png)\n", None),
    ("[a](u)\n", None),
    ("[a]\n", None),
    ("a [b] c\n", None),
    ("`a`\n\n``b``\n", None),
    ("\\[ ] a\n", None),
    ("[x] a\n", None),
    # 이스케이프
    ("\\1. a\n", None),
    ("\\- a\n\n\\# a\n\n\\> a\n\n\\| a\n\n\\+ a\n\n\\![a](b)\n", None),
    ("\\``` a\n", None),
    ("```\n\\*\n```\n", None),
    ("a\\.b \\_ \\= \\) \\] \\[ \\`\n", None),
    # 섞인 문서
    ("""# 새 문법 모음

## 1. 글 서식

[링크 **굵은** 글](https://example.com/a_(b)) · `코드 ` 백틱` · ==형광펜== · H<sub>2</sub>O · x<sup>2</sup>

{가운데}가운데 정렬 문단{/가운데}

{오른쪽}**오른쪽** 정렬{/오른쪽}

## 2. 목록

1. 하나
2. 둘
   - 둘 아래 글머리
     1. 더 아래 번호
3. 셋
- [ ] 할 일
- [x] 끝낸 일

7. 일곱부터
8. 여덟

## 3. 코드 · 가로줄 · 쪽 나눔

```py
def f():
    # 섹션 머리가 아니다
    return "```"
```
> 코드 아래 비고

---

<!-- pagebreak -->
""", None),
]


def _write_cases() -> list[dict]:
    """손으로 만든 문서 → MD (화면의 docToMarkdown 이 같은 글자를 쓰는지 본다)."""

    def doc(*blocks: dict, dialect: str | None = None) -> dict:
        out: dict = {
            "title": "쓰기",
            "sections": [{"key": "s1", "title": "섹션", "blocks": [{"id": f"b{i}", "title": None, "notes": [], **b} for i, b in enumerate(blocks)]}],
        }
        if dialect:
            out["dialect"] = dialect
        return out

    def items(*rows: tuple) -> dict:
        out = []
        for text, level, *extra in rows:
            it: dict = {"text": text, "level": level}
            if extra and extra[0]:
                it["ordered"] = True
            if len(extra) > 1 and extra[1] is not None:
                it["start"] = extra[1]
            if len(extra) > 2 and extra[2] is not None:
                it["checked"] = extra[2]
            out.append(it)
        return {"kind": "list", "items": out}

    cases = [
        (doc(items(("a", 0, True), ("b", 0, True), ("c", 1), ("d", 2, True), ("e", 0, True, 7), ("f", 0, True))), None),
        (doc(items(("a", 0, True, 9), ("b", 1, True, 10), ("c", 1, True), ("d", 0, True), ("e", 3, True))), None),
        (doc(items(("a", 0, False, None, False), ("b", 0, False, None, True), ("c", 0, True, None, False), ("d", 1, True, 0, True))), None),
        (doc(items(("a", 1), ("b", 5, True), ("c", 0))), None),
        (doc(items(("a", 0, True, 99), ("b", 1, True), ("c", 2, False), ("d", 1, True, 3))), None),
        (doc({"kind": "code", "lang": "py", "code": "x = 1\nprint(x)"}), None),
        (doc({"kind": "code", "lang": "", "code": "a ``` b\n````\n`"}), None),
        (doc({"kind": "code", "lang": "", "code": ""}), None),
        (doc({"kind": "code", "lang": "md", "code": "# 제목\n## 섹션", "title": "제목 있는 코드", "notes": ["비고"]}), None),
        (doc({"kind": "rule"}, {"kind": "pagebreak"}, {"kind": "rule", "title": "제목 + 줄"}), None),
        (doc({"kind": "text", "text": "가운데", "align": "center"}, {"kind": "text", "text": "오른쪽", "align": "right"},
             {"kind": "text", "text": "양쪽", "align": "justify"}, {"kind": "text", "text": "", "align": "center", "title": "빈 문단"}), None),
        (doc({"kind": "text", "text": "가운데", "align": "center"}, {"kind": "text", "text": "오른쪽", "align": "right"},
             {"kind": "text", "text": "양쪽", "align": "justify"}, dialect="en"), None),
        (doc({"kind": "text", "text": "가운데", "align": "center"}, dialect="ko"), "en"),
        (doc({"kind": "text", "text": "가운데", "align": "center"}), "en"),
        (doc({"kind": "text", "text": "문단", "align": None}), None),
    ]
    return [{"doc": d, "dialect": dl, "md": md.doc_md(d, dl)} for d, dl in cases]


def build() -> dict:
    doc = md.apply_md(None, MD)  # 한 번 되읽은 문서가 기준이다
    example = md.apply_md(None, example_md())
    doc_en = md.apply_md(None, _to_en(MD))  # 영어 태그로 쓴 같은 문서
    example_en = md.apply_md(None, EXAMPLE_EN.read_text(encoding="utf-8"))
    rnd = random.Random(20261113)
    alphabet = [
        "가", "나", " ", " ", "*", "~", "{", "}", "\\", "<", "br>", "{빨강}", "{/밑줄}", "{기울임}", "\n", "a", "|", "^", "-", "#",
        "`", "[", "]", "(", ")", "=", ".", "_", "<sup>", "{가운데}", "1", "2",
        "](", "](a",
    ]
    rand = []
    for _ in range(600):
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
        rand.append({
            "raw": _json(raw), "norm": _json(norm),
            "md": [inline.write(norm, c) for c in CTX], "mdEn": [inline.write(norm, c, "en") for c in CTX],
        })
    grids = [
        [["a", "<", "c"], ["^", "^", "d"], ["e", "f", "<"]],
        [["기준", "<"], ["^", "따로"]],
        [["a", "<"], ["^", "<"]],
        [["<", "a"], ["^", "b"]],
        [["^", "<"]],
        [["a", "<br>", "<"]],
        [["a", "^"], ["<", "^"], ["^", "<"]],
    ]
    tables = []
    for rows in grids:
        sp, hidden = table.spans(rows)
        tables.append({
            "rows": rows,
            "spans": sorted([r, c, h, w] for (r, c), (h, w) in sp.items()),
            "hidden": sorted([r, c] for r, c in hidden),
            "canonical": table.canonical(rows),
        })
    return {
        "doc": doc,
        "md": md.doc_md(doc),
        "example": {"doc": example, "md": md.doc_md(example)},
        "en": {"doc": doc_en, "md": md.doc_md(doc_en)},
        "exampleEn": {"doc": example_en, "md": md.doc_md(example_en)},
        "dialect": [
            {"src": s, "dialect": inline.dialect_of(s)}
            for s in (MD, _to_en(MD), "글만\n", "{red} 짝 없음\n{밑줄}x{/밑줄}", "\\{red}x\\{/red} {음영}y{/음영}", "a {Red}b{/RED}\n{빨강}c{/빨강}")
        ],
        "inline": [
            {
                "src": s,
                "segs": _json(inline.normalize(inline.segments(s))),
                "canon": [inline.canon(s, c) for c in CTX],
                "canonEn": [inline.canon(s, c, "en") for c in CTX],
                "cellShade": list(inline.cell_shade(s)),
            }
            for s in INLINE
        ],
        "parse": [{"src": src, "dialect": dl, "doc": md.parse(src, dl)} for src, dl in PARSE],
        "write": _write_cases(),
        "random": rand,
        "titles": [
            {"src": s, "ko": inline.title(s), "en": inline.title(s, "en")}
            for s in ("  **굵게**   보통  ", "줄<br>바꿈", "a {빨강} b{/빨강}", "{기울임} 앞 공백{/기울임}끝", "1.31** 각주", "a\u3000\u00a0b\x1cc",
                      "**a ** b", "{red}x{/red} {밑줄} {/밑줄}", "")
        ],
        "tables": tables,
    }


def test_fixture_is_current():
    text = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if os.environ.get("MDITOR_WRITE_FIXTURE"):
        PATH.parent.mkdir(parents=True, exist_ok=True)
        PATH.write_text(text, encoding="utf-8")
    assert PATH.exists(), "기준 파일이 없습니다 — MDITOR_WRITE_FIXTURE=1 로 만드세요"
    assert PATH.read_text(encoding="utf-8") == text, "기준 파일이 낡았습니다 — MDITOR_WRITE_FIXTURE=1 로 다시 만드세요"


def test_fixture_md_reads_back_to_itself():
    data = build()
    again = md.apply_md(data["doc"], data["md"])
    assert again == data["doc"] and md.doc_md(again) == data["md"]
    en = data["en"]
    assert md.doc_md(md.apply_md(en["doc"], en["md"])) == en["md"] and "{red}" in en["md"] and "{빨강}" not in en["md"]
