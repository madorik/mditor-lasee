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

PATH = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "rich" / "fixture.json"
CTX = (None, "cell", "para", "item")
EXAMPLE_EN = Path(__file__).resolve().parents[1] / "src" / "mditor" / "data" / "example.en.md"


def _to_en(text: str) -> str:
    """한국어 태그를 영어 태그로 바꾼 같은 문서."""
    return re.sub(r"\{(/?)(빨강|파랑|회색|기울임|밑줄|음영)\}", lambda m: "{" + m.group(1) + inline.EN[m.group(2)] + "}", text)



def _json(segs):
    return [s.to_json() for s in segs]


def build() -> dict:
    doc = md.apply_md(None, MD)  # 한 번 되읽은 문서가 기준이다
    example = md.apply_md(None, example_md())
    doc_en = md.apply_md(None, _to_en(MD))  # 영어 태그로 쓴 같은 문서
    example_en = md.apply_md(None, EXAMPLE_EN.read_text(encoding="utf-8"))
    rnd = random.Random(20261113)
    alphabet = ["가", "나", " ", " ", "*", "~", "{", "}", "\\", "<", "br>", "{빨강}", "{/밑줄}", "{기울임}", "\n", "a", "|", "^", "-", "#"]
    rand = []
    for _ in range(400):
        raw = [
            Seg(
                "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 5))),
                rnd.random() < 0.4, rnd.random() < 0.4, rnd.random() < 0.3, rnd.random() < 0.3,
                rnd.choice([None, None, "빨강", "파랑"]),
                rnd.random() < 0.3,
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
