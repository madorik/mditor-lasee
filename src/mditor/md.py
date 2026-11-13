"""MD 쓰기 · 읽기 · id 잇기.

원본은 구조 문서(JSON)이고 MD 는 편집 표현이다. MD 파서는 여기 하나뿐이다 —
화면(TipTap)은 MD 를 직접 파싱하지 않고 ``apply_md`` 가 되읽은 문서를 받아 연다.
화면의 직렬화(web/src/lib/rich/convert.ts ``fromPM``)는 ``doc_md`` 와 바이트 단위로 같아야 한다.

문서 = {title, sections: [{key, title, blocks: [블록]}]}
블록 = {id, kind, title, notes, …}
  kind "text"  : text (문단 하나. 제목만 있는 블록이면 "")
  kind "list"  : items [{text, level}]
  kind "table" : head [[칸]], rows [[칸]], align [None|"left"|"center"|"right"]
  kind "image" : src, caption
"""

from __future__ import annotations

import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any

from . import inline, table

MAX_LEVEL = 3
MAX_COLS = 40

_HEAD = re.compile(r"^(#{1,6})(?:\s+(.*))?$")
_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_EMPTY_BULLET = re.compile(r"^\s*[-*+]\s*$")
_RULE = re.compile(r"^[ \t]*([-*])(?:[ \t]*\1){2,}[ \t]*$")
_IMAGE = re.compile(r"^!\[(.*)\]\((.*)\)$")
_NOTE = re.compile(r"^>\s?(.*)$")
_DELIM_CELL = re.compile(r"^:?-+:?$")
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DELIM = {None: "---", "left": ":---", "center": ":---:", "right": "---:"}

Doc = dict[str, Any]
Block = dict[str, Any]


class MdError(ValueError):
    """MD 를 읽다 난 오류. ``line`` 은 1부터 세는 줄 번호."""

    def __init__(self, line: int | None, message: str) -> None:
        super().__init__(message if line is None else f"{line}번째 줄: {message}")
        self.line = line
        self.message = message

    def to_json(self) -> dict[str, Any]:
        return {"line": self.line, "message": self.message}


# ───────────────────────── 쓰기 ─────────────────────────


def _one_line(s: Any) -> str:
    return " ".join(str(s or "").split())


def _row(cells: list[str]) -> str:
    return "| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |"


def block_md(b: Block) -> str:
    lines: list[str] = []
    if b.get("title"):
        lines.append(f"### {_one_line(b['title'])}")
    kind = b["kind"]
    if kind == "text":
        if b.get("text"):
            lines.append(b["text"])
    elif kind == "list":
        for it in b["items"]:
            lines.append(f"{'  ' * int(it.get('level') or 0)}- {it['text']}")
    elif kind == "table":
        lines += [_row(r) for r in b["head"]]
        width = len(b["head"][-1])
        align = [*(b.get("align") or []), *([None] * width)][:width]
        lines.append("|" + "".join(f"{_DELIM[a]}|" for a in align))
        lines += [_row(r) for r in b["rows"]]
    elif kind == "image":
        lines.append(f"![{_one_line(b.get('caption'))}]({str(b.get('src') or '').strip()})")
    for n in b.get("notes") or []:
        if n:
            lines.append(f"> {n}")
    return "\n".join(lines)


def section_md(s: dict[str, Any], *, heading: bool = True) -> str:
    parts = [f"## {_one_line(s.get('title'))}".rstrip()] if heading else []
    parts += [block_md(b) for b in s.get("blocks") or []]
    return "\n\n".join(p for p in parts if p)


def doc_md(doc: Doc) -> str:
    """문서 → MD. 블록 사이는 빈 줄 하나, 끝은 줄바꿈 하나."""
    parts: list[str] = []
    if doc.get("title"):
        parts.append(f"# {_one_line(doc['title'])}")
    for i, s in enumerate(doc.get("sections") or []):
        parts.append(section_md(s, heading=bool(s.get("title")) or i > 0))
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


def _cell(raw: str) -> str:
    if table.marker(raw):
        return raw
    shaded, inner = inline.cell_shade(raw)
    text = inline.canon(inner, "cell")
    return f"{{음영}}{text}{{/음영}}" if shaded else text


def _table(rows: list[tuple[int, list[str]]]) -> Block:
    d = next((i for i, (_, cells) in enumerate(rows) if cells and all(_DELIM_CELL.match(c) for c in cells)), None)
    if d is None:
        raise MdError(rows[0][0], "표에 구분선(|---|) 줄이 없습니다. 머리글 줄 바로 아래에 넣으세요.")
    if d == 0:
        raise MdError(rows[0][0], "구분선(|---|) 위에 머리글 줄이 없습니다.")
    width = len(rows[d - 1][1])
    if width > MAX_COLS:
        raise MdError(rows[d - 1][0], f"표는 {MAX_COLS}칸까지 쓸 수 있습니다(지금 {width}칸).")
    grid: list[list[str]] = []
    for ln, cells in [*rows[:d], *rows[d + 1 :]]:
        if len(cells) > width:
            raise MdError(ln, f"이 줄은 {len(cells)}칸인데 머리글은 {width}칸입니다.")
        grid.append([_cell(c) for c in [*cells, *([""] * (width - len(cells)))]])
    marks = [*rows[d][1], *(["---"] * width)][:width]
    return {
        "kind": "table",
        "head": table.canonical(grid[:d]),
        "rows": table.canonical(grid[d:]),
        "align": [_align(c) for c in marks],
    }


def _finish(b: Block) -> Block | None:
    """읽던 블록을 표준 꼴로 닫는다. 내용이 하나도 없으면 None."""
    kind = b.get("kind") or "text"
    out: Block = {"kind": kind, "title": b.get("title") or None}
    if kind == "text":
        out["text"] = b.get("text") or ""
    elif kind == "list":
        items: list[dict[str, Any]] = []
        for it in b["items"]:
            level = min(it["level"], items[-1]["level"] + 1) if items else 0
            items.append({"text": it["text"], "level": level})
        out["items"] = items
    elif kind == "table":
        out.update(head=b["head"], rows=b["rows"], align=b["align"])
    else:
        out.update(src=b["src"], caption=b["caption"])
    out["notes"] = b.get("notes") or []
    if kind == "text" and not out["title"] and not out["text"] and not out["notes"]:
        return None
    return out


def parse_blocks(lines: list[tuple[int, str]]) -> list[Block]:
    """(줄 번호, 줄) → id 없는 블록 목록. 섹션 머리(##)는 여기 오기 전에 걸러진다.

    묶는 규칙: 제목(###)이 새 블록을 연다. 문단·목록·표·그림은 아직 본문이 없을 때만 지금 블록에 붙고,
    아니면 제목 없는 새 블록을 연다(목록 항목은 같은 목록에 이어 붙는다). 비고(>)는 지금 블록에 붙는다.
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
        if not text or _RULE.match(raw):
            continue
        m = _HEAD.match(text)
        if m:
            flush()
            cur = {"title": _one_line(m.group(2)) or None}
            continue
        if text.startswith("|"):
            rows = [(ln, split_cells(text))]
            while i < len(lines) and lines[i][1].strip().startswith("|"):
                rows.append((lines[i][0], split_cells(lines[i][1])))
                i += 1
            body("table").update(_table(rows))
            continue
        m = _BULLET.match(raw.replace("\t", "  "))
        if m:
            item_text = inline.canon(m.group(2), "item")
            if not item_text:
                continue
            level = min(len(m.group(1)) // 2, MAX_LEVEL)
            if cur is not None and cur.get("kind") == "list" and not cur.get("notes"):
                cur["items"].append({"text": item_text, "level": level})
            else:
                body("list")["items"] = [{"text": item_text, "level": level}]
            continue
        if _EMPTY_BULLET.match(raw):
            continue
        m = _NOTE.match(text)
        if m:
            note = inline.canon(m.group(1))
            if note:
                if cur is None:
                    cur = {}
                cur.setdefault("notes", []).append(note)
            continue
        m = _IMAGE.match(text)
        if m:
            body("image").update(src=m.group(2).strip(), caption=_one_line(m.group(1)))
            continue
        para = inline.canon(text, "para")
        if para:
            body("text")["text"] = para
    flush()
    return out


def parse(text: str) -> Doc:
    """MD → id 없는 문서. 줄 번호가 든 MdError 를 낸다."""
    title = ""
    sections: list[dict[str, Any]] = []
    cur: list[tuple[int, str]] = []
    cur_title = ""
    seen = False

    def close() -> None:
        blocks = parse_blocks(cur)
        if cur_title or blocks or sections:
            sections.append({"title": cur_title, "blocks": blocks})

    for n, line in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), start=1):
        m = _HEAD.match(line.strip())
        level = len(m.group(1)) if m else 0
        if level == 1 and not seen:
            title = _one_line(m.group(2))  # type: ignore[union-attr]
        elif level in (1, 2):
            close()
            cur, cur_title = [], _one_line(m.group(2))  # type: ignore[union-attr]
        else:
            cur.append((n, line))
        if line.strip():
            seen = True
    close()
    if sections and not sections[0]["title"] and not sections[0]["blocks"]:
        sections.pop(0)
    return {"title": title, "sections": sections}


# ───────────────────────── id 잇기 ─────────────────────────

_BODY = ("text", "items", "head", "rows", "align", "src", "caption")


def _sig(b: Block) -> str:
    """블록 내용 그대로(id 빼고). 같으면 손대지 않은 블록이다."""
    return json.dumps(
        [b["kind"], b.get("title") or "", [b.get(k) for k in _BODY], b.get("notes") or []],
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
    else:
        body = f"{b.get('caption') or ''} {b.get('src') or ''}"
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
                if isinstance(b.get("id"), str) and b.get("kind") in ("text", "list", "table", "image"):
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
        for kind in ("text", "list", "table", "image"):
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


def apply_md(base: Any, text: str) -> Doc:
    """MD 를 읽어 원본(base)의 id 를 이은 새 문서를 만든다. 원본은 고치지 않는다."""
    return attach_ids(parse(text), base)


# ───────────────────────── 견주기 ─────────────────────────


def _label(b: Block) -> str:
    text = b.get("title") or inline.plain(_content(b).strip().split("\n")[0])
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
            if b.get("notes"):
                row["notes"] = len(b["notes"])
            blocks.append(row)
        out.append({"key": s["key"], "title": s["title"], "blocks": blocks})
    return out


_FULL = "<!-- mditor:full -->"
_PART = "<!-- mditor:sections -->"


def _split_sections(text: str) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """MD → (첫 ## 앞의 줄들, [(섹션 머리 줄, 그 아래 줄들)])."""
    lead: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        m = _HEAD.match(line.strip())
        if m and len(m.group(1)) == 2:
            sections.append((line.strip(), []))
        elif sections:
            sections[-1][1].append(line)
        else:
            lead.append(line)
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
        return body + "\n", ["(문서 전체)"]
    if not known or "".join(lead).strip():
        return body + "\n", ["(문서 전체)"]
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
