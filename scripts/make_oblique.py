"""PDF 기울임용 글꼴을 만든다 — 원본 글꼴의 글자 모양을 오른쪽으로 기울인 사본(oblique).

우리 글꼴(Pretendard JP · 나눔)에는 기울임체가 없다. 브라우저는 기울임을 스스로 흉내 내지만(약 14°)
reportlab 은 그러지 못하므로, 같은 각도로 기울인 글꼴을 미리 만들어 함께 둔다.

    uv run python scripts/make_oblique.py        # src/mditor/fonts/oblique/ 에 만든다

라이선스: 원본은 SIL OFL 1.1 이고 '예약된 글꼴 이름'(Pretendard, Nanum …)이 있다. 고친 글꼴에는 그 이름을 쓸 수
없으므로 글꼴 안의 이름과 파일 이름을 'MDitor Oblique …' 로 바꾼다. 저작권 표시와 OFL 은 그대로 둔다.
"""

from __future__ import annotations

from pathlib import Path

from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parents[1] / "src" / "mditor" / "fonts"
OUT = FONTS / "oblique"
SLANT = 0.25  # x += 0.25·y (≈14°) — 브라우저가 흉내 내는 기울임과 비슷하게
ANGLE = -14.04

# (원본, 새 가족 이름, 굵기 이름)
SOURCES = [
    ("PretendardJP-Regular.ttf", "MDitor Oblique Sans", "Regular"),
    ("PretendardJP-Bold.ttf", "MDitor Oblique Sans", "Bold"),
    ("NanumMyeongjo-Regular.ttf", "MDitor Oblique Serif", "Regular"),
    ("NanumMyeongjo-Bold.ttf", "MDitor Oblique Serif", "Bold"),
    ("NanumGothic-Regular.ttf", "MDitor Oblique Gothic", "Regular"),
    ("NanumGothic-Bold.ttf", "MDitor Oblique Gothic", "Bold"),
    ("NanumPenScript-Regular.ttf", "MDitor Oblique Pen", "Regular"),
]


def file_name(family: str, weight: str) -> str:
    return f"{family.lower().replace('mditor ', '').replace(' ', '-')}-{weight.lower()}.ttf"  # oblique-serif-bold.ttf


def slant(src: Path, family: str, weight: str) -> Path:
    font = TTFont(src)
    glyf, hmtx = font["glyf"], font["hmtx"]
    for name in font.getGlyphOrder():
        g = glyf[name]
        if g.isComposite():
            for comp in g.components:  # 부품은 각자 기울어지므로 놓는 자리만 옮긴다
                comp.x = round(comp.x + SLANT * comp.y)
        elif g.numberOfContours > 0:
            coords = g.coordinates
            for i, (x, y) in enumerate(coords):
                coords[i] = (round(x + SLANT * y), y)
        if hasattr(g, "program"):  # 힌트는 기울이면 맞지 않는다
            g.program.fromBytecode(b"")
    for name in font.getGlyphOrder():
        g = glyf[name]
        g.recalcBounds(glyf)
        width, _ = hmtx[name]
        hmtx[name] = (width, getattr(g, "xMin", 0))

    font["post"].italicAngle = ANGLE
    font["hhea"].caretSlopeRise, font["hhea"].caretSlopeRun = 4, 1
    font["head"].macStyle |= 0x02
    os2 = font["OS/2"]
    os2.fsSelection = (os2.fsSelection | 0x01) & ~0x40  # ITALIC, REGULAR 아님
    for tag in ("DSIG", "hdmx", "LTSH", "VDMX", "fpgm", "prep", "cvt "):  # 서명·힌트 표는 맞지 않게 되므로 뺀다
        if tag in font:
            del font[tag]
    if "gasp" in font:
        del font["gasp"]

    # 이름 바꾸기 — 예약된 글꼴 이름을 쓰지 않는다
    style = "Italic" if weight == "Regular" else f"{weight} Italic"
    ps = f"{family.replace(' ', '')}-{style.replace(' ', '')}"
    names = font["name"]
    for rec in list(names.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22):
            names.removeNames(nameID=rec.nameID)
    full = f"{family} {style}"
    for nid, value in ((1, family if weight == "Regular" else f"{family} {weight}"), (2, "Italic"), (3, f"MDitor:{ps}"),
                       (4, full), (6, ps), (16, family), (17, style)):
        names.setName(value, nid, 3, 1, 0x409)
        names.setName(value, nid, 1, 0, 0)
    copyright_ = names.getDebugName(0) or ""
    names.setName(f"{copyright_} Slanted copy made for MDitor PDF output (SIL OFL 1.1).".strip(), 5, 3, 1, 0x409)

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / file_name(family, weight)
    font.save(out)
    return out


def main() -> None:
    for src, family, weight in SOURCES:
        out = slant(FONTS / src, family, weight)
        print(f"{src} → {out.relative_to(FONTS)} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
