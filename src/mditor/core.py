"""API 서버와 MCP 서버가 같이 쓰는 동작 — 둘 다 여기만 부른다(파서·렌더가 한 벌이 되도록)."""

from __future__ import annotations

import base64
import contextlib
import re
import secrets
import time
import zlib
from pathlib import Path
from typing import Any

from . import md, render
from .render import Options

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class InputError(ValueError):
    """받은 값이 한도를 넘거나 모양이 틀렸다."""


def clean(text: str, limit: int) -> str:
    if not isinstance(text, str):
        raise InputError("markdown 은 문자열이어야 합니다.")
    if len(text) > limit:
        raise InputError(f"문서가 너무 깁니다({len(text):,}자). {limit:,}자까지 다룰 수 있습니다.")
    return _CONTROL.sub("", text)


def read(text: str, base: Any = None, prev: Any = None) -> dict[str, Any]:
    """MD → 되읽은 문서. 미리보기·저장·AI 대조가 모두 이 결과를 쓴다. 저장하지 않는다.

    base 는 저장본(변경 표시의 기준), prev 는 직전에 되읽은 문서(id 를 잇는 기준)다.
    """
    try:
        doc = md.apply_md(md.union_base(prev, base) if prev else base, text)
    except md.MdError as e:
        return {"ok": False, "error": e.to_json()}
    canonical = md.doc_md(doc)
    return {
        "ok": True,
        "doc": doc,
        "md": canonical,
        "canonical": canonical == text,
        "changes": md.diff(base, doc) if base else None,
    }


def stats(doc: dict[str, Any]) -> dict[str, int]:
    blocks = [b for s in doc["sections"] for b in s["blocks"]]
    return {
        "sections": len(doc["sections"]),
        "blocks": len(blocks),
        "tables": sum(b["kind"] == "table" for b in blocks),
        "lists": sum(b["kind"] == "list" for b in blocks),
        "images": sum(b["kind"] == "image" for b in blocks),
    }


def layout(doc: dict[str, Any], options: Any = None, images: Any = None, image_sizes: Any = None) -> dict[str, Any]:
    return render.render(doc, _options(options), images, image_sizes)[1]


def pdf(doc: dict[str, Any], options: Any = None, images: Any = None, image_sizes: Any = None) -> tuple[bytes, dict[str, Any]]:
    return render.render(doc, _options(options), images, image_sizes)


def _options(options: Any) -> Options:
    return options if isinstance(options, Options) else Options.from_json(options)


def page_report(doc: dict[str, Any], lay: dict[str, Any]) -> dict[str, Any]:
    """쪽 배치를 사람·AI 가 읽기 쉬운 꼴로: 섹션·블록이 몇 쪽에 있고 어디서 쪽이 넘어가는지."""
    sections = []
    for s in doc["sections"]:
        blocks = []
        for o, b in zip(md.outline({"sections": [s]})[0]["blocks"], s["blocks"]):
            row: dict[str, Any] = {**o, "page": lay["blocks"].get(b["id"])}
            if b["kind"] == "list":
                pages = lay["items"].get(b["id"], {})
                breaks = [
                    {"item": i + 1, "page": pages[str(i)]}
                    for i in range(1, len(b["items"]))
                    if pages.get(str(i)) and pages.get(str(i - 1)) and pages[str(i)] != pages[str(i - 1)]
                ]
                if breaks:
                    row["continues"] = breaks
            elif b["kind"] == "table":
                pieces = sorted((int(k), v) for k, v in lay["rows"].get(b["id"], {}).items())
                if len(pieces) > 1:
                    row["continues"] = [{"row": k + 1, "page": v} for k, v in pieces[1:]]
            blocks.append(row)
        sections.append({"title": s["title"], "page": lay["sections"].get(s["key"]), "blocks": blocks})
    return {"total_pages": lay["total"], "sections": sections}


def editor_link(public_url: str, text: str) -> str | None:
    """웹 편집기에서 이 문서를 여는 링크. 내용은 주소의 # 뒤에 실려 서버로 가지 않는다."""
    if not public_url:
        return None
    raw = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = raw.compress(text.encode("utf-8")) + raw.flush()
    return f"{public_url}/edit#md={base64.urlsafe_b64encode(packed).decode('ascii').rstrip('=')}"


def decode_images(images: Any, limit: int) -> dict[str, bytes]:
    """{이름: data URI | base64} → {이름: 바이트}. 합계가 한도를 넘으면 InputError."""
    out: dict[str, bytes] = {}
    total = 0
    if not isinstance(images, dict):
        return out
    for name, value in images.items():
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        data = render.decode_data_uri(value) if value.startswith("data:") else _b64(value)
        if data is None:
            continue
        total += len(data)
        if total > limit:
            raise InputError(f"그림이 너무 큽니다. 합쳐서 {limit // 1_000_000}MB 까지 붙일 수 있습니다.")
        out[name] = data
    return out


def _b64(value: str) -> bytes | None:
    try:
        return base64.b64decode(value, validate=True)
    except Exception:  # noqa: BLE001
        return None


def store_download(cache_dir: Path, ttl: int, data: bytes) -> str:
    """PDF 를 잠깐 보관하고 토큰을 돌려준다(원격 MCP 의 내려받기 링크). 오래된 것은 이때 지운다."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for old in cache_dir.glob("*.pdf"):
        with contextlib.suppress(OSError):
            if now - old.stat().st_mtime > ttl:
                old.unlink()
    token = secrets.token_urlsafe(24)
    (cache_dir / f"{token}.pdf").write_bytes(data)
    return token
