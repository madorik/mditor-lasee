"""MD 쓰기 · 읽기 · id 잇기.

원본은 구조 문서(JSON)이고 MD 는 편집 표현이다. MD 파서는 여기 하나뿐이다 —
화면(TipTap)은 MD 를 직접 파싱하지 않고 ``apply_md`` 가 되읽은 문서를 받아 연다.
쓰기 · 읽기 규칙은 화면 쪽 web/packages/lasee-mditor/src/core/{parse,write}.ts 와 **같다**(화면 쪽이 기준 구현이다).
고치면 둘 다 고친다(공유 기준 파일 tests/test_fixture.py 가 잡는다).

문서 = {title, sections: [{key, title, blocks: [블록]}], dialect}   dialect: 문서의 태그 언어("ko" | "en")
블록 = {id, kind, title, notes, …}
  kind "text"     : text (문단 하나. 제목만 있는 블록이면 ""), align (가운데 · 오른쪽 · 양쪽 — 왼쪽이면 없다)
  kind "list"     : items [{text, level, ordered?, start?, checked?}]
  kind "table"    : head [[칸]], rows [[칸]], align [None|"left"|"center"|"right"]
  kind "image"    : src, caption, width (그림 폭 — 본문 폭의 %, 1~100. 없으면 원래 크기)
  kind "code"     : lang, code
  kind "rule"     : (가로줄)
  kind "pagebreak": (쪽 나눔)
"""

from __future__ import annotations

import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any

from . import inline, table
from .i18n import t

MAX_LEVEL = 3
MAX_COLS = 40

_HEAD = re.compile(r"^(#{1,6})(?:\s+(.*))?$")
# 목록 항목: 들여쓰기, 글머리(- * +) 또는 번호(1. 1)), 글. 번호는 ASCII 숫자만(\d 는 유니코드 숫자까지 잡는다)
_LIST_ITEM = re.compile(r"^(\s*)(?:([-*+])|([0-9]{1,9})([.)]))\s+(.*)$")
_EMPTY_ITEM = re.compile(r"^\s*(?:[-*+]|[0-9]{1,9}[.)])\s*$")
_TASK = re.compile(r"^\[([ xX])\](?:\s+(.*))?$")
_RULE = re.compile(r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_IMAGE = re.compile(r"^!\[(.*)\]\((.*)\)(?:\{width=(100|[1-9][0-9]?)%\})?$")
_NOTE = re.compile(r"^>\s?(.*)$")
_DELIM_CELL = re.compile(r"^:?-+:?$")
_PAGEBREAK = re.compile(r"^<!--[ \t]*pagebreak[ \t]*-->\Z", re.IGNORECASE | re.ASCII)
_FENCE_OPEN = re.compile(r"^( {0,3})(`{3,})([^`]*)\Z")
_FENCE_CLOSE = re.compile(r"^ {0,3}(`{3,})[ \t]*\Z")
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DELIM = {None: "---", "left": ":---", "center": ":---:", "right": "---:"}
_ALIGN_TAG = {"center": "가운데", "right": "오른쪽", "justify": "양쪽"}

Doc = dict[str, Any]
Block = dict[str, Any]


class MdError(ValueError):
    """MD 를 읽다 난 오류. ``line`` 은 1부터 세는 줄 번호."""

    def __init__(self, line: int | None, message: str) -> None:
        super().__init__(message if line is None else t("{line}번째 줄: {message}", line=line, message=message))
        self.line = line
        self.message = message

    def to_json(self) -> dict[str, Any]:
        return {"line": self.line, "message": self.message}


# ───────────────────────── 쓰기 ─────────────────────────


def _one_line(s: Any) -> str:
    return " ".join(str(s or "").split())


def _row(cells: list[str]) -> str:
    return "| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |"


def _walk_items(items: list[dict[str, Any]]) -> list[tuple[dict[str, Any], int, str, int]]:
    """목록 항목마다 (항목, 단계, 글머리 · 번호 글자, 들여쓰기). 번호는 구간마다 시작 번호(start, 없으면 1)부터 이어 센다.
    들여쓰기는 부모 항목의 글 시작 칸에 맞춘다."""
    out: list[tuple[dict[str, Any], int, str, int]] = []
    cols: list[int] = []  # 단계마다 글 시작 칸
    nums: list[int | None] = []  # 단계마다 지금 번호(번호 구간이 아니면 None)
    for it in items:
        level = max(0, min(int(it.get("level") or 0), len(cols)))
        nums = nums[: level + 1]
        while len(nums) < level + 1:
            nums.append(None)
        marker = "-"
        if it.get("ordered"):
            prev = nums[level]
            start = it.get("start")
            n = prev + 1 if prev is not None else (1 if start is None else int(start))
            nums[level] = n
            marker = f"{n}."
        else:
            nums[level] = None
        indent = 0 if level == 0 else cols[level - 1]
        del cols[level:]
        cols.append(indent + len(marker) + 1)
        out.append((it, level, marker, indent))
    return out


def item_lines(items: list[dict[str, Any]]) -> list[str]:
    """목록 항목 → 줄들."""
    lines: list[str] = []
    for it, _level, marker, indent in _walk_items(items):
        checked = it.get("checked")
        box = "" if checked is None else "[x] " if checked else "[ ] "
        lines.append(f"{' ' * indent}{marker} {box}{it['text']}")
    return lines


def item_markers(items: list[dict[str, Any]]) -> list[tuple[int, str | None]]:
    """목록 항목마다 (단계, 번호 글자 — 번호 항목이 아니면 None). PDF 가 글머리 대신 그리는 번호가 MD 에 쓰는 번호와 같게 한다."""
    return [(level, marker if it.get("ordered") else None) for it, level, marker, _ in _walk_items(items)]


def code_fence(code: str) -> str:
    """코드 블록의 울타리 — 코드 안의 가장 긴 백틱보다 하나 길게(3개 이상)."""
    longest = max((len(m.group(0)) for m in re.finditer(r"`+", code)), default=0)
    return "`" * max(3, longest + 1)


def align_text(text: str, align: str | None, dialect: str) -> str:
    """문단의 정렬을 태그로 감싼다(``{가운데}…{/가운데}``)."""
    if not align or not text or align not in _ALIGN_TAG:
        return text
    name = inline.tag(_ALIGN_TAG[align], dialect)
    return f"{{{name}}}{text}{{/{name}}}"


def block_md(b: Block, dialect: str = "ko") -> str:
    lines: list[str] = []
    if b.get("title"):
        lines.append(f"### {_one_line(b['title'])}")
    kind = b["kind"]
    if kind == "text":
        if b.get("text"):
            lines.append(align_text(b["text"], b.get("align"), dialect))
    elif kind == "list":
        lines += item_lines(b["items"])
    elif kind == "table":
        lines += [_row(r) for r in b["head"]]
        width = len(b["head"][-1])
        align = [*(b.get("align") or []), *([None] * width)][:width]
        lines.append("|" + "".join(f"{_DELIM[a]}|" for a in align))
        lines += [_row(r) for r in b["rows"]]
    elif kind == "image":
        width = b.get("width")
        lines.append(f"![{_one_line(b.get('caption'))}]({str(b.get('src') or '').strip()})" + (f"{{width={width}%}}" if width else ""))
    elif kind == "code":
        code = b.get("code") or ""
        fence = code_fence(code)
        lines.append(fence + (b.get("lang") or ""))
        if code:
            lines += code.split("\n")
        lines.append(fence)
    elif kind == "rule":
        lines.append("---")
    elif kind == "pagebreak":
        lines.append("<!-- pagebreak -->")
    for n in b.get("notes") or []:
        if n:
            lines.append(f"> {n}")
    return "\n".join(lines)


def section_md(s: dict[str, Any], *, heading: bool = True, dialect: str = "ko") -> str:
    parts = [f"## {_one_line(s.get('title'))}".rstrip()] if heading else []
    parts += [block_md(b, dialect) for b in s.get("blocks") or []]
    return "\n\n".join(p for p in parts if p)


def doc_md(doc: Doc, dialect: str | None = None) -> str:
    """문서 → MD. 블록 사이는 빈 줄 하나, 끝은 줄바꿈 하나. 정렬 태그는 문서의 태그 언어(``doc["dialect"]``)로 쓴다."""
    dl = dialect or doc.get("dialect") or "ko"
    parts: list[str] = []
    if doc.get("title"):
        parts.append(f"# {_one_line(doc['title'])}")
    for i, s in enumerate(doc.get("sections") or []):
        parts.append(section_md(s, heading=bool(s.get("title")) or i > 0, dialect=dl))
    body = "\n\n".join(p for p in parts if p)
    return body + "\n" if body else ""


# ───────────────────────── 읽기 ─────────────────────────


def split_cells(line: str) -> list[str]:
    """표 한 줄 → 칸. ``\\|`` 는 칸 안의 글자 ``|`` 이다(다른 이스케이프는 글 서식 쪽에서 푼다)."""
    s = line.strip()
    s = s.removeprefix("|")
    cells: list[str] = []
    cur: list[str] = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "\\" and i + 1 < len(s):
            cur.append("|" if s[i + 1] == "|" else ch + s[i + 1])
            i += 2
        elif ch == "|":
            cells.append("".join(cur))
            cur = []
            i += 1
        else:
            cur.append(ch)
            i += 1
    last = "".join(cur)
    if last.strip() or not cells:
        cells.append(last)
    return [c.strip() for c in cells]


def _align(delim: str) -> str | None:
    left, right = delim.startswith(":"), delim.endswith(":")
    return "center" if left and right else "left" if left else "right" if right else None


def _cell(raw: str, dialect: str) -> str:
    if table.marker(raw):
        return raw
    shaded, inner = inline.cell_shade(raw)
    text = inline.canon(inner, "cell", dialect)
    shade = inline.tag("음영", dialect)
    return f"{{{shade}}}{text}{{/{shade}}}" if shaded else text


def _table(rows: list[tuple[int, list[str]]], dialect: str) -> Block:
    d = next((i for i, (_, cells) in enumerate(rows) if cells and all(_DELIM_CELL.match(c) for c in cells)), None)
    if d is None:
        raise MdError(rows[0][0], t("표에 구분선(|---|) 줄이 없습니다. 머리글 줄 바로 아래에 넣으세요."))
    if d == 0:
        raise MdError(rows[0][0], t("구분선(|---|) 위에 머리글 줄이 없습니다."))
    width = len(rows[d - 1][1])
    if width > MAX_COLS:
        raise MdError(rows[d - 1][0], t("표는 {max}칸까지 쓸 수 있습니다(지금 {width}칸).", max=MAX_COLS, width=width))
    grid: list[list[str]] = []
    for ln, cells in [*rows[:d], *rows[d + 1 :]]:
        if len(cells) > width:
            raise MdError(ln, t("이 줄은 {cells}칸인데 머리글은 {width}칸입니다.", cells=len(cells), width=width))
        grid.append([_cell(c, dialect) for c in [*cells, *([""] * (width - len(cells)))]])
    marks = [*rows[d][1], *(["---"] * width)][:width]
    return {
        "kind": "table",
        "head": table.canonical(grid[:d]),
        "rows": table.canonical(grid[d:]),
        "align": [_align(c) for c in marks],
    }


def finish_items(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """목록 항목들의 단계를 다듬고(앞 항목보다 한 단계까지만 깊어진다), 번호 구간의 첫 항목에 시작 번호를 단다."""
    items: list[dict[str, Any]] = []
    ord_at: list[bool] = []  # 단계마다: 같은 부모 아래 바로 앞 항목이 번호 항목인가
    for it in raw:
        level = min(it["level"], items[-1]["level"] + 1) if items else 0
        del ord_at[level + 1 :]
        while len(ord_at) < level + 1:
            ord_at.append(False)
        out: dict[str, Any] = {"text": it["text"], "level": level}
        if it["ordered"]:
            out["ordered"] = True
            if not ord_at[level] and it["num"] != 1:
                out["start"] = it["num"]
        if it["checked"] is not None:
            out["checked"] = it["checked"]
        ord_at[level] = it["ordered"]
        items.append(out)
    return items


def _finish(b: Block) -> Block | None:
    """읽던 블록을 표준 꼴로 닫는다. 내용이 하나도 없으면 None."""
    kind = b.get("kind") or "text"
    title = b.get("title") or None
    notes = b.get("notes") or []
    out: Block = {"kind": kind, "title": title}
    if kind == "text":
        text = b.get("text") or ""
        if not title and not text and not notes:
            return None
        out["text"] = text
        out["notes"] = notes
        if text and b.get("align"):
            out["align"] = b["align"]
        return out
    if kind == "list":
        out["items"] = finish_items(b["items"])
    elif kind == "table":
        out.update(head=b["head"], rows=b["rows"], align=b["align"])
    elif kind == "image":
        out.update(src=b["src"], caption=b["caption"])
        if b.get("width"):
            out["width"] = b["width"]
    elif kind == "code":
        out.update(lang=b.get("lang") or "", code=b.get("code") or "")
    out["notes"] = notes
    return out


def open_fence(line: str) -> dict[str, Any] | None:
    """코드 울타리(```)를 여는 줄이면 {indent: 들여쓰기, size: 백틱 수, lang: 언어}."""
    m = _FENCE_OPEN.match(line)
    if not m:
        return None
    info = m.group(3).strip().split()
    return {"indent": len(m.group(1)), "size": len(m.group(2)), "lang": info[0] if info else ""}


def _closes_fence(line: str, fence: dict[str, Any]) -> bool:
    m = _FENCE_CLOSE.match(line)
    return bool(m) and len(m.group(1)) >= fence["size"]


def _dedent(line: str, n: int) -> str:
    """줄 앞의 빈칸을 n 칸까지 뗀다(울타리를 들여 쓴 만큼)."""
    k = 0
    while k < n and k < len(line) and line[k] == " ":
        k += 1
    return line[k:]


def parse_blocks(lines: list[tuple[int, str]], dialect: str = "ko") -> list[Block]:
    """(줄 번호, 줄) → id 없는 블록 목록. 섹션 머리(##)는 여기 오기 전에 걸러진다.

    묶는 규칙: 제목(###)이 새 블록을 연다. 본문(문단 · 목록 · 표 · 그림 · 코드 · 가로줄 · 쪽 나눔)은 아직 본문이 없을 때만
    지금 블록에 붙고, 아니면 제목 없는 새 블록을 연다(목록 항목은 같은 목록에 이어 붙는다). 비고(>)는 지금 블록에 붙는다.
    """
    out: list[Block] = []
    cur: Block | None = None

    def flush() -> None:
        nonlocal cur
        if cur is not None:
            done = _finish(cur)
            if done:
                out.append(done)
        cur = None

    def body(kind: str) -> Block:
        """본문을 받을 블록 — 제목만 있는 블록이면 그것, 아니면 새 블록."""
        nonlocal cur
        if cur is None or cur.get("kind") is not None or cur.get("notes"):
            flush()
            cur = {}
        cur["kind"] = kind
        return cur

    i = 0
    while i < len(lines):
        ln, raw = lines[i]
        text = raw.strip()
        i += 1
        fence = open_fence(raw)
        if fence:
            code: list[str] = []
            while i < len(lines):
                line = lines[i][1]
                i += 1
                if _closes_fence(line, fence):
                    break
                code.append(_dedent(line, fence["indent"]))
            while code and not code[-1].strip():
                code.pop()
            body("code").update(lang=fence["lang"], code="\n".join(code))
            continue
        if not text:
            continue
        if _PAGEBREAK.match(text):
            body("pagebreak")
            continue
        if _RULE.match(raw):
            body("rule")
            continue
        m = _HEAD.match(text)
        if m:
            flush()
            cur = {"title": inline.title(m.group(2) or "", dialect) or None}
            continue
        if text.startswith("|"):
            rows = [(ln, split_cells(text))]
            while i < len(lines) and lines[i][1].strip().startswith("|"):
                rows.append((lines[i][0], split_cells(lines[i][1])))
                i += 1
            body("table").update(_table(rows, dialect))
            continue
        m = _LIST_ITEM.match(raw.replace("\t", "  "))
        if m:
            rest = m.group(5)
            checked: bool | None = None
            task = _TASK.match(rest)
            if task:
                checked = task.group(1) != " "
                rest = task.group(2) or ""
            item_text = inline.canon(rest, "item", dialect)
            if not item_text:
                continue
            indent = len(m.group(1))
            mark = m.group(2) if m.group(2) is not None else m.group(3) + m.group(4)
            if cur is not None and cur.get("kind") == "list" and not cur.get("notes"):
                lst = cur
            else:
                lst = body("list")
                lst["items"], lst["cols"] = [], []
            cols: list[int] = lst["cols"]
            level = 0
            while level < len(cols) and indent >= cols[level]:
                level += 1
            level = min(level, MAX_LEVEL)
            del cols[level:]
            cols.append(indent + len(mark) + 1)
            lst["items"].append(
                {
                    "text": item_text,
                    "level": level,
                    "ordered": m.group(2) is None,
                    "num": int(m.group(3)) if m.group(3) else 0,
                    "checked": checked,
                }
            )
            continue
        if _EMPTY_ITEM.match(raw):
            continue
        m = _NOTE.match(text)
        if m:
            note = inline.canon(m.group(1), None, dialect)
            if note:
                if cur is None:
                    cur = {}
                cur.setdefault("notes", []).append(note)
            continue
        m = _IMAGE.match(text)
        if m:
            img = body("image")
            img.update(src=m.group(2).strip(), caption=_one_line(m.group(1)))
            if m.group(3):
                img["width"] = int(m.group(3))
            continue
        align, inner, _ = inline.block_align(text)
        para = inline.canon(inner, "para", dialect)
        if para:
            blk = body("text")
            blk["text"], blk["align"] = para, align
    flush()
    return out


def parse(text: str, dialect: str | None = None) -> Doc:
    """MD → id 없는 문서. 줄 번호가 든 MdError 를 낸다.

    글 서식 태그는 문서의 태그 언어로 쓴다 — 문서에 태그가 있으면 그것(``inline.dialect_of``),
    없으면 ``dialect``(부르는 쪽의 언어), 그것도 없으면 한국어. 정한 태그 언어는 문서의 ``dialect`` 에 남는다.
    """
    dialect = inline.dialect_of(text) or dialect or "ko"
    title = ""
    sections: list[dict[str, Any]] = []
    cur: list[tuple[int, str]] = []
    cur_title = ""
    seen = False
    fence: dict[str, Any] | None = None

    def close() -> None:
        blocks = parse_blocks(cur, dialect)
        if cur_title or blocks or sections:
            sections.append({"title": cur_title, "blocks": blocks})

    for n, line in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), start=1):
        if fence is not None:  # 코드 울타리 안은 섹션 머리가 아니다
            cur.append((n, line))
            if _closes_fence(line, fence):
                fence = None
            continue
        opened = open_fence(line)
        if opened:
            fence = opened
            cur.append((n, line))
            seen = True
            continue
        m = _HEAD.match(line.strip())
        level = len(m.group(1)) if m else 0
        if level == 1 and not seen:
            title = inline.title(m.group(2) or "", dialect)  # type: ignore[union-attr]
        elif level in (1, 2):
            close()
            cur, cur_title = [], inline.title(m.group(2) or "", dialect)  # type: ignore[union-attr]
        else:
            cur.append((n, line))
        if line.strip():
            seen = True
    close()
    if sections and not sections[0]["title"] and not sections[0]["blocks"]:
        sections.pop(0)
    return {"title": title, "sections": sections, "dialect": dialect}


# ───────────────────────── id 잇기 ─────────────────────────

_BODY = ("text", "items", "head", "rows", "align", "src", "caption", "lang", "code")
_KINDS = ("text", "list", "table", "image", "code", "rule", "pagebreak")


def _sig(b: Block) -> str:
    """블록 내용 그대로(id 빼고). 같으면 손대지 않은 블록이다."""
    return json.dumps(
        # 그림 폭은 있을 때만 넣는다 — 폭이 없는 블록의 지문(그리고 id)이 예전과 같게
        [b["kind"], b.get("title") or "", [b.get(k) for k in _BODY] + ([b["width"]] if b.get("width") else []), b.get("notes") or []],
        ensure_ascii=False,
        sort_keys=True,
    )


def _content(b: Block) -> str:
    """비슷한 정도를 잴 글자."""
    kind = b["kind"]
    if kind == "text":
        body = b.get("text") or ""
    elif kind == "list":
        body = "\n".join(it["text"] for it in b["items"])
    elif kind == "table":
        body = "\n".join(" ".join(r) for r in [*b["head"], *b["rows"]])
    elif kind == "image":
        body = f"{b.get('caption') or ''} {b.get('src') or ''}"
    elif kind == "code":
        body = b.get("code") or ""
    else:  # rule · pagebreak — 내용이 없다
        body = ""
    return f"{b.get('title') or ''}\n{body}"


def _new_id(prefix: str, seed: str, taken: set[str]) -> str:
    base = prefix + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8]
    out, n = base, 1
    while out in taken:
        n += 1
        out = f"{base}-{n}"
    taken.add(out)
    return out


def _base_sections(base: Any) -> list[dict[str, Any]]:
    """밖에서 온 원본 문서에서 id 잇기에 쓸 것만 추린다. 모양이 틀리면 빈 목록."""
    out: list[dict[str, Any]] = []
    try:
        for s in base.get("sections") or []:
            blocks = []
            for b in s.get("blocks") or []:
                if isinstance(b.get("id"), str) and b.get("kind") in _KINDS:
                    _sig(b), _content(b)  # 모양 검사
                    blocks.append(b)
            if isinstance(s.get("key"), str):
                out.append({"key": s["key"], "title": str(s.get("title") or ""), "blocks": blocks})
    except Exception:  # noqa: BLE001 — 원본이 깨졌으면 새 문서로 본다
        return []
    return out


def attach_ids(doc: Doc, base: Any = None) -> Doc:
    """되읽은 문서의 섹션·블록에 원본의 key·id 를 잇는다(제자리에서 고치고 돌려준다).

    섹션: 제목이 같은 것 → 같은 순번. 블록: 내용이 그대로인 것(다른 섹션으로 옮겨도 잇는다)
    → 같은 섹션·같은 종류에서 제목이 같은 것 → 내용이 비슷한 것 → 같은 순번. 못 이으면 새 id.
    """
    orig = _base_sections(base)
    taken_keys = {s["key"] for s in orig}
    taken_ids = {b["id"] for s in orig for b in s["blocks"]}

    # 섹션
    free = list(range(len(orig)))
    pairs: dict[int, int] = {}
    for i, s in enumerate(doc["sections"]):
        j = next((j for j in free if orig[j]["title"] == s["title"]), None)
        if j is not None:
            pairs[i] = j
            free.remove(j)
    for i, s in enumerate(doc["sections"]):
        if i not in pairs and i in free:
            pairs[i] = i
            free.remove(i)
    for i, s in enumerate(doc["sections"]):
        s["key"] = orig[pairs[i]]["key"] if i in pairs else _new_id("s", f"{i}|{s['title']}", taken_keys)

    # 블록 1: 내용이 그대로인 것 — 같은 섹션 먼저, 그다음 문서 전체
    used: set[str] = set()
    by_sig: dict[str, list[tuple[str, str]]] = {}
    for s in orig:
        for b in s["blocks"]:
            by_sig.setdefault(_sig(b), []).append((s["key"], b["id"]))
    for same_section in (True, False):
        for s in doc["sections"]:
            for b in s["blocks"]:
                if "id" in b:
                    continue
                for key, bid in by_sig.get(_sig(b), []):
                    if bid not in used and (key == s["key"] or not same_section):
                        b["id"] = bid
                        used.add(bid)
                        break

    # 블록 2~4: 같은 섹션 · 같은 종류 안에서
    for i, s in enumerate(doc["sections"]):
        o_blocks = orig[pairs[i]]["blocks"] if i in pairs else []
        for kind in _KINDS:
            new = [b for b in s["blocks"] if b["kind"] == kind]
            old = [b for b in o_blocks if b["kind"] == kind]

            for b in new:  # 제목
                if "id" not in b and b.get("title"):
                    o = next((o for o in old if o["id"] not in used and o.get("title") == b["title"]), None)
                    if o:
                        b["id"] = o["id"]
                        used.add(o["id"])
            scored: list[tuple[float, int, int]] = []  # 비슷한 정도
            cand = [o for o in old if o["id"] not in used]
            for bi, b in enumerate(new):
                if "id" in b:
                    continue
                for oi, o in enumerate(cand):
                    sm = SequenceMatcher(None, _content(b), _content(o), autojunk=False)
                    if sm.quick_ratio() >= 0.5:
                        ratio = sm.ratio()
                        if ratio >= 0.5:
                            scored.append((-ratio, bi, oi))
            for _, bi, oi in sorted(scored):
                if "id" not in new[bi] and cand[oi]["id"] not in used:
                    new[bi]["id"] = cand[oi]["id"]
                    used.add(cand[oi]["id"])
            for n, b in enumerate(new):  # 같은 순번
                if "id" not in b and n < len(old) and old[n]["id"] not in used:
                    b["id"] = old[n]["id"]
                    used.add(old[n]["id"])

    taken_ids |= used
    for s in doc["sections"]:
        for b in s["blocks"]:
            if "id" not in b:
                b["id"] = _new_id("b", f"{b['kind']}|{_sig(b)}", taken_ids)
    for s in doc["sections"]:
        s["blocks"] = [{"id": b["id"], **{k: v for k, v in b.items() if k != "id"}} for b in s["blocks"]]
    doc["sections"] = [{"key": s["key"], "title": s["title"], "blocks": s["blocks"]} for s in doc["sections"]]
    return doc


def union_base(prev: Any, base: Any) -> dict[str, Any]:
    """id 를 이을 원본 = 직전에 되읽은 문서(prev) + 저장본(base)에만 남아 있는 블록.

    글을 치는 동안에는 직전 결과에서 id 를 이어야 블록이 흔들리지 않고, 지웠다 되살린 블록은
    저장본의 id 를 되찾아야 '새 블록'으로 보이지 않는다.
    """
    out = [{"key": s["key"], "title": s["title"], "blocks": list(s["blocks"])} for s in _base_sections(prev)]
    by_key = {s["key"]: s for s in out}
    have = {b["id"] for s in out for b in s["blocks"]}
    for s in _base_sections(base):
        target = by_key.get(s["key"])
        if target is None:
            target = {"key": s["key"], "title": s["title"], "blocks": []}
            out.append(target)
            by_key[s["key"]] = target
        target["blocks"] += [b for b in s["blocks"] if b["id"] not in have]
    return {"sections": out}


def apply_md(base: Any, text: str, dialect: str | None = None) -> Doc:
    """MD 를 읽어 원본(base)의 id 를 이은 새 문서를 만든다. 원본은 고치지 않는다."""
    return attach_ids(parse(text, dialect), base)


# ───────────────────────── 견주기 ─────────────────────────


def _label(b: Block) -> str:
    text = inline.plain(b.get("title") or "") or inline.plain(_content(b).strip().split("\n")[0])
    if not text:  # 글자가 없는 블록은 종류 이름으로
        if b["kind"] == "code":
            text = t("코드 블록")
        elif b["kind"] == "rule":
            text = t("가로줄")
        elif b["kind"] == "pagebreak":
            text = t("쪽 나눔")
    return text if len(text) <= 40 else text[:39] + "…"


def diff(base: Any, doc: Doc) -> dict[str, Any]:
    """원본과 견준 변경 — 블록 id 기준."""
    old = {b["id"]: (s, b) for s in _base_sections(base) for b in s["blocks"]}
    added: list[str] = []
    modified: list[str] = []
    seen: set[str] = set()
    for s in doc["sections"]:
        for b in s["blocks"]:
            seen.add(b["id"])
            if b["id"] not in old:
                added.append(b["id"])
            elif _sig(old[b["id"]][1]) != _sig(b):
                modified.append(b["id"])
    removed = [
        {"id": bid, "kind": b["kind"], "label": _label(b), "section": s["title"]}
        for bid, (s, b) in old.items()
        if bid not in seen
    ]
    base_titles = [s["title"] for s in _base_sections(base)]
    return {
        "added": added,
        "modified": modified,
        "removed": removed,
        "title": isinstance(base, dict) and (base.get("title") or "") != (doc.get("title") or ""),
        "sections": base_titles != [s["title"] for s in doc["sections"]],
    }


def outline(doc: Doc) -> list[dict[str, Any]]:
    """문서 뼈대 — 섹션과 블록 한 줄 요약."""
    out = []
    for s in doc["sections"]:
        blocks = []
        for b in s["blocks"]:
            row: dict[str, Any] = {"id": b["id"], "kind": b["kind"], "label": _label(b)}
            if b["kind"] == "list":
                row["items"] = len(b["items"])
            elif b["kind"] == "table":
                row["size"] = f"{len(b['head']) + len(b['rows'])}행 × {len(b['head'][-1])}열"
            elif b["kind"] == "code":
                row["lines"] = len((b.get("code") or "").split("\n")) if b.get("code") else 0
                if b.get("lang"):
                    row["lang"] = b["lang"]
            if b.get("notes"):
                row["notes"] = len(b["notes"])
            blocks.append(row)
        out.append({"key": s["key"], "title": s["title"], "blocks": blocks})
    return out


_FULL = "<!-- mditor:full -->"
_PART = "<!-- mditor:sections -->"


def _split_sections(text: str) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """MD → (첫 ## 앞의 줄들, [(섹션 머리 줄, 그 아래 줄들)]). 코드 울타리 안의 ## 은 섹션 머리가 아니다."""
    lead: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    fence: dict[str, Any] | None = None
    for line in text.replace("\r\n", "\n").split("\n"):
        if fence is None:
            fence = open_fence(line)
            if fence is None:
                m = _HEAD.match(line.strip())
                if m and len(m.group(1)) == 2:
                    sections.append((line.strip(), []))
                    continue
        elif _closes_fence(line, fence):
            fence = None
        (sections[-1][1] if sections else lead).append(line)
    return lead, sections


def merge_sections(current: str, reply: str) -> tuple[str, list[str]]:
    """AI 응답을 지금 문서에 합친다 → (합친 MD, 바뀐 섹션 제목들).

    응답은 문서 전체이거나(``<!-- mditor:full -->``) 고친 섹션만(``<!-- mditor:sections -->``)이다.
    섹션만 온 경우 머리(##) 줄이 같은 섹션을 통째로 바꾼다. 표시가 없으면 머리가 전부 지금 문서에 있고
    ## 앞에 다른 내용이 없을 때만 섹션 응답으로 본다.
    """
    body = reply.strip()
    mode = None
    for marker, name in ((_FULL, "full"), (_PART, "part")):
        if body.startswith(marker):
            body, mode = body[len(marker) :].strip(), name
    if body.startswith("```"):  # 코드 울타리로 감싼 응답
        lines = body.split("\n")
        body = "\n".join(lines[1:-1] if lines[-1].strip().startswith("```") else lines[1:]).strip()
    if not body:
        return current, []
    lead, parts = _split_sections(body)
    cur_lead, cur_parts = _split_sections(current)
    heads = [_one_line(h) for h, _ in cur_parts]
    known = all(_one_line(h) in heads for h, _ in parts)
    if mode != "part" and not (mode is None and parts and known and not "".join(lead).strip()):
        return body + "\n", [t("(문서 전체)")]
    if not known or "".join(lead).strip():
        return body + "\n", [t("(문서 전체)")]
    used: set[int] = set()
    changed: list[str] = []
    out = list(cur_parts)
    for head, lines in parts:
        i = next((i for i, h in enumerate(heads) if h == _one_line(head) and i not in used), None)
        if i is None:
            continue
        used.add(i)
        if "\n".join(out[i][1]).strip() != "\n".join(lines).strip():
            changed.append(_one_line(head).lstrip("# ").strip())
        out[i] = (cur_parts[i][0], ["", *"\n".join(lines).strip().split("\n"), ""])
    text = "\n".join([*cur_lead, *(line for head, lines in out for line in (head, *lines))])
    return text.rstrip("\n") + "\n", changed


def numbers(text: str) -> list[str]:
    """글 속의 숫자(쉼표는 뗀다)."""
    return [m.group(0).replace(",", "") for m in _NUM.finditer(text)]


def new_numbers(before: str, after: str) -> list[str]:
    """``after`` 에 새로 나온 숫자 — AI 가 고친 글에 근거 없는 수치가 끼었는지 볼 때 쓴다."""
    known = set(numbers(before))
    out: list[str] = []
    for n in numbers(after):
        if n not in known and n not in out:
            out.append(n)
    return out
