"""PDF 렌더(reportlab) — 그리면서 블록·항목·표 행이 몇 쪽에 놓였는지 적는다.

쪽은 화면에서 짐작하지 않는다. 여기서 PDF 를 실제로 그리고, 각 블록의 첫 flowable 과 항목 문단에 단
꼬리표(``layout_tags``)가 놓인 쪽을 ``afterFlowable`` 에서 적는다. 화면은 쪽 번호가 바뀌는 자리에 경계를 그린다.

쪽 나눔 규칙(여기에만 있다 — 화면은 결과를 따라간다)
- 블록(섹션 머리 + 제목 + 본문 + 비고)은 남은 자리에 안 들어가면 통째로 다음 쪽으로 넘긴다(KeepBlock).
- 한 쪽보다 큰 블록은 남은 자리가 쪽의 1/4 이상이면 그 자리에서 나눈다. 표는 행 단위로 나누고 머리글을 반복한다.
- 문단은 한 쪽보다 길 때만 나눈다(WholeParagraph).
- ``section_break`` 를 켜면 섹션마다 새 쪽에서 시작한다.
"""

from __future__ import annotations

import base64
import io
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.fonts import addMapping
from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, PageBreak, PageTemplate, Paragraph, Table, TableStyle
from reportlab.platypus.doctemplate import FrameBreak, LayoutError, NullActionFlowable

from . import inline, table
from .i18n import t

FONT = "MDitor"  # 기본 글꼴(Pretendard JP) — 그림 자리 표시 등
FONT_BOLD = "MDitor-Bold"
_FONT_DIR = Path(__file__).parent / "fonts"
_LOCK = threading.Lock()  # reportlab 의 문단 파서는 스레드 안전하지 않다

# 문서 글꼴(쪽 설정에서 문서마다 하나): 보통 · 굵게 · 기울임 · 굵은 기울임.
# 기울임은 원본을 기울인 사본이다(scripts/make_oblique.py) — 원본 글꼴에 기울임체가 없다.
# 굵은 꼴이 없는 글꼴은 굵게도 보통 꼴로 쓴다(화면도 굵게를 흉내 내지 않는다).
FAMILIES: dict[str, tuple[str, str | None, str, str | None]] = {
    "pretendard": ("PretendardJP-Regular.ttf", "PretendardJP-Bold.ttf", "oblique/oblique-sans-regular.ttf", "oblique/oblique-sans-bold.ttf"),
    "nanum-myeongjo": ("NanumMyeongjo-Regular.ttf", "NanumMyeongjo-Bold.ttf", "oblique/oblique-serif-regular.ttf", "oblique/oblique-serif-bold.ttf"),
    "nanum-gothic": ("NanumGothic-Regular.ttf", "NanumGothic-Bold.ttf", "oblique/oblique-gothic-regular.ttf", "oblique/oblique-gothic-bold.ttf"),
    "nanum-pen": ("NanumPenScript-Regular.ttf", None, "oblique/oblique-pen-regular.ttf", None),
}
DEFAULT_FONT = "pretendard"
_families: dict[str, tuple[str, str]] = {}

INK = colors.HexColor("#1b2430")
MUTED = colors.HexColor("#5b6672")
LINE = colors.HexColor("#9aa3ad")
HEAD_BG = colors.HexColor("#eef1f4")
SHADE_BG = colors.HexColor(inline.SHADE)
BULLETS = ("•", "–", "·", "·")
MAX_IMAGE_PIXELS = 40_000_000
PX = 0.75  # 화면 1px = 0.75pt (96dpi)


class RenderError(ValueError):
    """문서를 쪽에 배치하지 못했다."""


@dataclass(frozen=True)
class Options:
    page: str = "A4"  # A4 | Letter
    landscape: bool = False
    margin_mm: float = 20.0
    font_size: float = 10.5
    section_break: bool = False
    page_numbers: bool = True
    font: str = DEFAULT_FONT  # FAMILIES 의 열쇠

    @classmethod
    def from_json(cls, data: Any) -> Options:
        d = data if isinstance(data, dict) else {}

        def num(key: str, default: float, lo: float, hi: float) -> float:
            try:
                return min(hi, max(lo, float(d.get(key, default))))
            except (TypeError, ValueError):
                return default

        return cls(
            page="Letter" if str(d.get("page", "A4")).lower() == "letter" else "A4",
            landscape=bool(d.get("landscape", False)),
            margin_mm=num("margin_mm", 20.0, 8.0, 40.0),
            font_size=num("font_size", 10.5, 8.0, 14.0),
            section_break=bool(d.get("section_break", False)),
            page_numbers=bool(d.get("page_numbers", True)),
            font=d["font"] if d.get("font") in FAMILIES else DEFAULT_FONT,
        )

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _family(key: str) -> tuple[str, str]:
    """글꼴 가족을 (처음 쓸 때) 등록하고 (보통, 굵게) 글꼴 이름을 돌려준다.
    문단 안의 <b> · <i> 는 addMapping 으로 굵게 · 기울임 · 굵은 기울임 꼴에 이어진다."""
    key = key if key in FAMILIES else DEFAULT_FONT
    if key in _families:
        return _families[key]
    regular, bold, italic, bold_italic = FAMILIES[key]
    base = FONT if key == DEFAULT_FONT else f"MDitor-{key}"
    files = {(0, 0): regular, (1, 0): bold, (0, 1): italic, (1, 1): bold_italic}
    names = {(0, 0): base, (1, 0): f"{base}-Bold", (0, 1): f"{base}-Italic", (1, 1): f"{base}-BoldItalic"}
    for (b, i), file in files.items():
        if file is None:  # 굵은 꼴이 없다 — 같은 기울기의 보통 꼴로
            addMapping(base, b, i, names[(0, i)])
            continue
        pdfmetrics.registerFont(TTFont(names[(b, i)], str(_FONT_DIR / file)))
        addMapping(base, b, i, names[(b, i)])
    _families[key] = (base, names[(1, 0)] if bold else base)
    return _families[key]


def _register() -> None:
    """기본 글꼴을 등록한다."""
    _family(DEFAULT_FONT)


def _has(font: str, chars: str) -> bool:
    cmap = pdfmetrics.getFont(font).face.charToGlyph
    return all(ord(ch) in cmap for ch in chars)


def _markup(font: str) -> Any:
    """서식 문자열 → reportlab 마크업. 고른 글꼴에 없는 글자(한자 · 기호 등)는 기본 글꼴로 그린다
    — 브라우저가 글꼴 목록의 다음 글꼴(Pretendard)로 채우는 것과 같다."""
    if font == FONT:
        return inline.rl_markup
    cmap = pdfmetrics.getFont(font).face.charToGlyph

    def wrap(line: str) -> str:
        out: list[str] = []
        run: list[str] = []
        missing = False
        for ch in line:
            m = ord(ch) not in cmap and not ch.isspace()
            if run and m != missing:
                text = _esc("".join(run))
                out.append(f'<font name="{FONT}">{text}</font>' if missing else text)
                run = []
            run.append(ch)
            missing = m
        if run:
            text = _esc("".join(run))
            out.append(f'<font name="{FONT}">{text}</font>' if missing else text)
        return "".join(out)

    return lambda s: inline.rl_markup(s, wrap)


# ───────────────────────── flowable ─────────────────────────


class WholeParagraph(Paragraph):
    """한 쪽에 들어가는 문단은 나누지 않는다 — 통째로 다음 쪽으로 간다."""

    def split(self, availWidth: float, availHeight: float) -> list[Any]:
        max_h = getattr(self, "_max_h", 0)
        if max_h and self.wrap(availWidth, 0xFFFFFF)[1] <= max_h:
            return []
        parts = Paragraph.split(self, availWidth, availHeight)
        if parts and getattr(self, "layout_tags", None):
            parts[0].layout_tags = self.layout_tags
        return parts


class SectionHead(WholeParagraph):
    """섹션 머리 — 아래에 가는 줄을 긋는다."""

    def draw(self) -> None:
        Paragraph.draw(self)
        self.canv.saveState()
        self.canv.setStrokeColor(INK)
        self.canv.setLineWidth(0.8)
        self.canv.line(0, -3, self.width, -3)
        self.canv.restoreState()


class TagTable(Table):
    """쪽을 넘어 나뉠 때 꼬리표를 첫 조각으로 옮기고, 조각마다 첫 본문 행 번호를 적는다."""

    _bid: str = ""
    _first_row: int = 0

    def split(self, availWidth: float, availHeight: float) -> list[Any]:
        self.splitInRow = 0
        parts = Table.split(self, availWidth, availHeight)
        frame = getattr(self, "_frame", None)
        if not parts and frame is not None and getattr(frame, "_atTop", False):
            self.splitInRow = 1  # 한 쪽보다 큰 행 — 빈 쪽 맨 위에서만 행 안을 나눈다
            parts = Table.split(self, availWidth, availHeight)
        if len(parts) > 1:
            repeat = self.repeatRows if isinstance(self.repeatRows, int) else 0
            first, rest = parts[0], parts[1]
            first._bid = rest._bid = self._bid
            first._first_row = self._first_row
            rest._first_row = self._first_row + max(0, len(first._cellvalues) - repeat)
            first.layout_tags = getattr(self, "layout_tags", [])
            rest.layout_tags = []
        return parts


class Figure(Flowable):
    """그림. 바이트가 없으면 같은 크기의 자리만 그린다(쪽 배치가 같아지도록)."""

    hAlign = "CENTER"

    def __init__(self, reader: Any, width: float, height: float, label: str) -> None:
        super().__init__()
        self.reader, self.width, self.height, self.label = reader, width, height, label

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        if self.reader is not None:
            c.drawImage(self.reader, 0, 0, self.width, self.height, mask="auto")
            return
        c.saveState()
        c.setStrokeColor(LINE)
        c.setDash(3, 3)
        c.rect(0.5, 0.5, self.width - 1, self.height - 1)
        c.setFillColor(MUTED)
        c.setFont(FONT, 9)
        c.drawCentredString(self.width / 2, self.height / 2 - 3, self.label)
        c.restoreState()


class KeepBlock(Flowable):
    """블록 하나를 통째로 다룬다(reportlab KeepTogether 대신 쓴다 — 겹쳐 넣지 않는다)."""

    def __init__(self, content: list[Any], max_h: float) -> None:
        super().__init__()
        self._content = content
        self._max_h = max_h

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return availWidth, 0xFFFFFF  # 언제나 split 으로 보낸다

    def _heights(self, width: float, at_top: bool) -> tuple[float, float]:
        """(블록 전체 높이, 나눠 그릴 때 첫 쪽에 꼭 들어가야 하는 높이)."""
        canv = getattr(self, "canv", None)
        total = lead = 0.0
        last = len(self._content) - 1
        for i, f in enumerate(self._content):
            before = 0.0 if (i == 0 and at_top) else f.getSpaceBefore()
            h = f.wrapOn(canv, width, 0xFFFFFF)[1]
            total += before + h + (f.getSpaceAfter() if i < last else 0.0)
            if isinstance(f, Table):  # 머리글 + 본문 첫 행
                repeat = f.repeatRows if isinstance(f.repeatRows, int) else 0
                lead += before + sum(f._rowHeights[: repeat + 1])
                break
            if isinstance(f, Paragraph) and h > self._max_h:  # 한 쪽보다 긴 문단은 몇 줄만
                lead += before + 3 * f.style.leading
                break
            lead += before + h + (f.getSpaceAfter() if i < last else 0.0)
            if getattr(f, "_is_body", False):
                break
        return total, lead

    def split(self, availWidth: float, availHeight: float) -> list[Any]:
        frame = getattr(self, "_frame", None)
        at_top = bool(frame is not None and getattr(frame, "_atTop", False))
        total, lead = self._heights(availWidth, at_top)
        here = [NullActionFlowable(), *self._content]
        if total <= availHeight + 1e-6 or at_top:
            return here
        if total <= self._max_h:  # 한 쪽에는 들어간다 → 통째로 다음 쪽
            return [FrameBreak(), *self._content]
        if availHeight >= self._max_h / 4 and lead <= availHeight:  # 한 쪽보다 크다 → 그 자리에서 나눈다
            return here
        return [FrameBreak(), *self._content]


class _Doc(BaseDocTemplate):
    def __init__(self, *args: Any, **kw: Any) -> None:
        super().__init__(*args, **kw)
        self.layout: dict[str, Any] = {"sections": {}, "blocks": {}, "items": {}, "rows": {}}

    def afterFlowable(self, flowable: Any) -> None:
        page = self.page
        lay = self.layout
        for tag in getattr(flowable, "layout_tags", ()):
            if tag[0] == "s":
                lay["sections"].setdefault(tag[1], page)
            elif tag[0] == "b":
                lay["blocks"].setdefault(tag[1], page)
            elif tag[0] == "i":
                lay["items"].setdefault(tag[1], {}).setdefault(str(tag[2]), page)
        if isinstance(flowable, TagTable) and flowable._bid:
            lay["rows"].setdefault(flowable._bid, {}).setdefault(str(flowable._first_row), page)


# ───────────────────────── 그림 ─────────────────────────


def decode_data_uri(src: str) -> bytes | None:
    if not src.startswith("data:") or "," not in src:
        return None
    meta, payload = src.split(",", 1)
    try:
        return base64.b64decode(payload) if ";base64" in meta else None
    except Exception:  # noqa: BLE001
        return None


def load_image(data: bytes) -> tuple[Any, int, int] | None:
    """바이트 → (reportlab 그림, 가로px, 세로px). 읽지 못하면 None."""
    from PIL import Image

    try:
        im = Image.open(io.BytesIO(data))
        if im.format not in ("PNG", "JPEG", "GIF", "WEBP", "BMP"):
            return None
        w, h = im.size
        if w < 1 or h < 1 or w * h > MAX_IMAGE_PIXELS:
            return None
        im.load()
        if im.mode not in ("RGB", "RGBA", "L"):
            im = im.convert("RGBA" if ("A" in im.mode or "transparency" in im.info) else "RGB")
        return ImageReader(im), w, h
    except Exception:  # noqa: BLE001 — 깨진 그림은 자리만 그린다
        return None


# ───────────────────────── 조립 ─────────────────────────


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _styles(size: float, font: str = FONT, bold: str = FONT_BOLD) -> dict[str, Any]:
    base = ParagraphStyle(
        "body", fontName=font, fontSize=size, leading=size * 1.6, textColor=INK, splitLongWords=1, spaceAfter=0
    )
    small = size * 0.9

    bold_font = bold

    def cell(name: str, align: int, strong: bool = False) -> ParagraphStyle:
        return ParagraphStyle(
            name, parent=base, fontName=bold_font if strong else font, fontSize=small, leading=small * 1.45, alignment=align
        )

    return {
        "body": base,
        "title": ParagraphStyle(
            "title", parent=base, fontName=bold_font, fontSize=size * 1.9, leading=size * 2.5, spaceAfter=size * 0.9
        ),
        "h2": ParagraphStyle(
            "h2", parent=base, fontName=bold_font, fontSize=size * 1.33, leading=size * 1.9,
            spaceBefore=size * 1.5, spaceAfter=size * 0.8,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base, fontName=bold_font, fontSize=size * 1.1, leading=size * 1.7, spaceBefore=size, spaceAfter=size * 0.25
        ),
        "items": [
            ParagraphStyle(
                f"item{lv}", parent=base, leftIndent=size * (1.3 + 1.3 * lv), bulletIndent=size * (0.3 + 1.3 * lv),
                bulletFontName=font if _has(font, "".join(BULLETS)) else FONT, bulletFontSize=size, spaceAfter=size * 0.15,
            )
            for lv in range(4)
        ],
        "note": ParagraphStyle(
            "note", parent=base, fontSize=small, leading=small * 1.5, textColor=MUTED, spaceBefore=size * 0.3
        ),
        "caption": ParagraphStyle(
            "caption", parent=base, fontSize=small, leading=small * 1.5, textColor=MUTED, alignment=TA_CENTER,
            spaceBefore=size * 0.35,
        ),
        "cell": {
            None: cell("c", TA_LEFT), "left": cell("cl", TA_LEFT), "center": cell("cc", TA_CENTER),
            "right": cell("cr", TA_RIGHT),
        },
        "th": {
            None: cell("h", TA_CENTER, True), "left": cell("hl", TA_LEFT, True), "center": cell("hc", TA_CENTER, True),
            "right": cell("hr", TA_RIGHT, True),
        },
        "gap": size * 0.75,
        "small": small,
        "font": font,
        "bold": bold_font,
        "markup": _markup(font),
    }


def _col_widths(b: dict[str, Any], avail: float, size: float, font: str = FONT, bold: str = FONT_BOLD) -> list[float]:
    """칸 너비: 글자 폭에 비례. 좁으면 긴 칸부터 줄인다. 표는 언제나 본문 폭을 채운다."""
    ncol = len(b["head"][-1])
    pad = 10.0
    nat = [size * 2 + pad] * ncol
    low = [size * 2 + pad] * ncol
    for rows, face in ((b["head"], bold), (b["rows"], font)):
        sp, hidden = table.spans(rows)
        for r, row in enumerate(rows):
            for c, raw in enumerate(row):
                if (r, c) in hidden or sp.get((r, c), (1, 1))[1] > 1:
                    continue
                text = "".join(seg.text for seg in inline.segments(inline.cell_shade(raw)[1]))
                for line in text.split("\n"):
                    nat[c] = max(nat[c], pdfmetrics.stringWidth(line, face, size) + pad)
                    word = max((pdfmetrics.stringWidth(w, face, size) for w in line.split()), default=0.0)
                    low[c] = max(low[c], min(word, size * 5) + pad)
    total = sum(nat)
    if total <= avail:
        return [w * avail / total for w in nat]
    if sum(low) >= avail:
        return [w * avail / sum(low) for w in low]
    spare = avail - sum(low)
    extra = [n - m for n, m in zip(nat, low)]
    return [m + spare * e / sum(extra) for m, e in zip(low, extra)]


def _table(b: dict[str, Any], st: dict[str, Any], avail: float) -> TagTable:
    head, rows = b["head"], b["rows"]
    ncol = len(head[-1])
    align = [*(b.get("align") or []), *([None] * ncol)][:ncol]
    data: list[list[Any]] = []
    cmds: list[tuple] = [
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("BACKGROUND", (0, 0), (-1, len(head) - 1), HEAD_BG),
    ]
    for grid, offset, is_head in ((head, 0, True), (rows, len(head), False)):
        sp, hidden = table.spans(grid)
        for r, row in enumerate(grid):
            line: list[Any] = []
            for c, raw in enumerate(row):
                if (r, c) in hidden:
                    line.append("")
                    continue
                shaded, inner = inline.cell_shade(raw)
                h, w = sp.get((r, c), (1, 1))
                # 머리글은 가운데가 기본. 여러 열에 걸친 머리글은 열 정렬을 따르지 않는다
                style = st["th"][None if w > 1 else align[c]] if is_head else st["cell"][align[c]]
                line.append(Paragraph(st["markup"](inner), style))
                if (h, w) != (1, 1):
                    cmds.append(("SPAN", (c, offset + r), (c + w - 1, offset + r + h - 1)))
                if shaded:
                    cmds.append(("BACKGROUND", (c, offset + r), (c + w - 1, offset + r + h - 1), SHADE_BG))
            data.append(line)
    t = TagTable(data, colWidths=_col_widths(b, avail, st["small"], st["font"], st["bold"]), repeatRows=len(head), splitByRow=1)
    t.setStyle(TableStyle(cmds))
    t._bid = b["id"]
    return t


def _figure(b: dict[str, Any], images: dict[str, Any], sizes: dict[str, Any], avail_w: float, max_h: float) -> Figure:
    src = str(b.get("src") or "")
    data = decode_data_uri(src) if src.startswith("data:") else images.get(src)
    if isinstance(data, str):
        data = decode_data_uri(data)
    loaded = load_image(data) if isinstance(data, (bytes, bytearray)) else None
    reader = None
    if loaded:
        reader, w, h = loaded
    else:
        try:
            w, h = (int(v) for v in sizes[src])
            if w < 1 or h < 1:
                raise ValueError
        except Exception:  # noqa: BLE001 — 크기를 모르는 그림
            w, h = 640, 320
    scale = min(1.0, avail_w / (w * PX), max_h * 0.45 / (h * PX))
    label = "그림" if not src or src.startswith("data:") else f"그림: {src[:40]}"
    return Figure(reader, w * PX * scale, h * PX * scale, label)


def _build(
    doc: dict[str, Any], opts: Options, images: dict[str, Any] | None, sizes: dict[str, Any] | None
) -> tuple[bytes, dict[str, Any]]:
    _register()
    font, bold = _family(opts.font)
    page = LETTER if opts.page == "Letter" else A4
    if opts.landscape:
        page = landscape(page)
    margin = opts.margin_mm * mm
    foot = 9 * mm if opts.page_numbers else 0
    frame_w, frame_h = page[0] - 2 * margin, page[1] - 2 * margin - foot
    max_h = frame_h - 0.5
    st = _styles(opts.font_size, font, bold)
    images, sizes = images or {}, sizes or {}

    def whole(text: str, style: Any, **kw: Any) -> WholeParagraph:
        p = WholeParagraph(text, style, **kw)
        p._max_h = max_h
        return p

    story: list[Any] = []
    if doc.get("title"):
        story.append(whole(st["markup"](doc["title"]), st["title"]))
    for si, s in enumerate(doc.get("sections") or []):
        if opts.section_break and si > 0:
            story.append(PageBreak())
        head: Any = None
        if s.get("title"):
            head = SectionHead(st["markup"](s["title"]), st["h2"])
            head._max_h = max_h
            head.layout_tags = [("s", s["key"])]
        for b in s.get("blocks") or []:
            flow: list[Any] = []
            if b.get("title"):
                flow.append(whole(st["markup"](b["title"]), st["h3"]))
            kind = b["kind"]
            body_at = len(flow)
            if kind == "text":
                if b.get("text"):
                    flow.append(whole(st["markup"](b["text"]), st["body"]))
            elif kind == "list":
                for idx, it in enumerate(b["items"]):
                    lv = min(int(it.get("level") or 0), 3)
                    p = whole(st["markup"](it["text"]), st["items"][lv], bulletText=BULLETS[lv])
                    p.layout_tags = [("i", b["id"], idx)]
                    flow.append(p)
            elif kind == "table":
                flow.append(_table(b, st, frame_w))
            elif kind == "image":
                flow.append(_figure(b, images, sizes, frame_w, max_h))
                if b.get("caption"):
                    flow.append(whole(st["markup"](inline.write([inline.Seg(b["caption"])])), st["caption"]))
            for n in b.get("notes") or []:
                flow.append(whole(st["markup"](n), st["note"]))
            if not flow:
                continue
            if body_at < len(flow):
                flow[body_at]._is_body = True
            if not b.get("title"):
                flow[0].spaceBefore = st["gap"]
            if kind == "table" and len(flow) > body_at:
                flow[body_at].spaceBefore = st["gap"] * 0.5 if b.get("title") else st["gap"]
                flow[body_at].spaceAfter = 0
            flow[0].layout_tags = [("b", b["id"]), *getattr(flow[0], "layout_tags", [])]
            if head is not None:
                flow.insert(0, head)
                head = None
            story.append(KeepBlock(flow, max_h))
        if head is not None:  # 블록 없는 섹션
            story.append(head)

    def on_page(canvas: Any, d: Any) -> None:
        if not opts.page_numbers:
            return
        canvas.saveState()
        canvas.setFont(font, 9)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(page[0] / 2, margin * 0.55 + 2 * mm, str(d.page))
        canvas.restoreState()

    buf = io.BytesIO()
    pdf = _Doc(
        buf, pagesize=page, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin + foot,
        title=inline.plain(doc.get("title") or "") or "문서", author="MDitor", creator="MDitor (mditor)",
    )
    frame = Frame(margin, margin + foot, frame_w, frame_h, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    pdf.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])
    try:
        pdf.build(story)
    except LayoutError as e:
        raise RenderError(t("문서를 쪽에 배치하지 못했습니다. 한 쪽보다 큰 그림이나 표 머리글이 있는지 확인하세요.")) from e
    layout = pdf.layout
    layout["total"] = max(1, pdf.page)
    for s in doc.get("sections") or []:  # 머리 없는 섹션은 첫 블록 쪽
        if s["key"] not in layout["sections"]:
            first = next((layout["blocks"].get(b["id"]) for b in s.get("blocks") or [] if b["id"] in layout["blocks"]), None)
            if first:
                layout["sections"][s["key"]] = first
    return buf.getvalue(), layout


def render(
    doc: dict[str, Any],
    options: Options | None = None,
    images: dict[str, Any] | None = None,
    image_sizes: dict[str, Any] | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """문서 → (PDF 바이트, 쪽 배치).

    쪽 배치 = {sections: {key: 쪽}, blocks: {id: 쪽}, items: {블록id: {순번: 쪽}},
              rows: {블록id: {조각의 첫 본문 행: 쪽}}, total}
    images: {이름: 바이트 | data URI}. image_sizes: {이름: [가로px, 세로px]} — 바이트 없이 자리만 잡을 때.
    """
    with _LOCK:
        return _build(doc, options or Options(), images, image_sizes)
