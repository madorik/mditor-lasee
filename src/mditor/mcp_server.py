"""MCP 서버 — AI 에이전트가 MDitor 문서를 쓰고, 검사하고, 쪽 배치를 보고, PDF 로 내게 한다.

두 가지로 돈다.
- 로컬(stdio):  ``mditor-mcp``            — PDF 를 파일로 쓴다. 그림은 로컬 파일을 읽는다.
- 원격(HTTP):   API 서버의 ``/mcp``      — PDF 는 잠깐 쓰는 내려받기 링크로 준다.

웹 편집기와 같은 파서·렌더(core)를 쓴다. 그래서 에이전트가 본 쪽 배치와 사람이 화면에서 보는 쪽이 같다.
"""

from __future__ import annotations

import argparse
import functools
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import quote

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field

from . import __version__, core, md
from .render import RenderError
from .settings import Settings, example_md, syntax_guide

INSTRUCTIONS = """MDitor turns a constrained Markdown dialect into a paginated PDF document (Korean formal reports, \
plans, minutes). The Markdown stays the single source: people edit it in the MDitor LaSee web editor, agents edit it here, \
and both see the same page breaks because pages come from actually rendering the PDF.

Typical flow: read `syntax_guide` once, write or edit the Markdown, run `check_markdown` until it reports ok, use \
`page_layout` if page breaks matter, then `render_pdf`. After editing an existing document, `diff_markdown` shows \
exactly which blocks changed and which numbers are new."""

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

Markdown = Annotated[str, Field(description="The whole document in MDitor Markdown.")]
PageSize = Annotated[Literal["A4", "Letter"], Field(description="Paper size.")]
Landscape = Annotated[bool, Field(description="Landscape orientation.")]
MarginMm = Annotated[float, Field(description="Page margin in millimetres (8-40).", ge=8, le=40)]
FontSize = Annotated[float, Field(description="Body font size in points (8-14).", ge=8, le=14)]
SectionBreak = Annotated[bool, Field(description="Start every `##` section on a new page.")]
PageNumbers = Annotated[bool, Field(description="Print page numbers in the footer.")]

_READ = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=False)


def open_security() -> TransportSecuritySettings:
    """공개 서비스용 — Host 검사(로컬 서버 보호용)를 끈다."""
    return TransportSecuritySettings(enable_dns_rebinding_protection=False)


def _options(page_size: str, landscape: bool, margin_mm: float, font_size: float, section_break: bool,
             page_numbers: bool = True) -> dict[str, Any]:
    return {"page": page_size, "landscape": landscape, "margin_mm": margin_mm, "font_size": font_size,
            "section_break": section_break, "page_numbers": page_numbers}


def _fail(message: str, line: int | None = None) -> dict[str, Any]:
    return {"ok": False, "error": {"line": line, "message": message}}


def build(settings: Settings | None = None, *, remote: bool = False) -> MCPServer:
    settings = settings or Settings()
    server = MCPServer(
        name="mditor",
        title="MDitor",
        description="Write Markdown, get a paginated PDF. Same parser and page layout as the MDitor LaSee web editor.",
        instructions=INSTRUCTIONS,
        website_url=settings.public_url or None,
        version=__version__,
    )

    def parsed(markdown: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        try:
            result = core.read(core.clean(markdown, settings.max_md_chars))
        except core.InputError as e:
            return None, _fail(str(e))
        return (result["doc"], result) if result["ok"] else (None, result)

    @server.tool(name="syntax_guide", title="MDitor syntax guide", annotations=_READ)
    def syntax_guide_tool() -> str:
        """Return the reference for the MDitor Markdown dialect: document skeleton, inline formatting tags, table
        cell merging and shading, images, and the page-break rules. Read it once before writing or editing an MDitor
        document — the dialect is ordinary Markdown plus a few conventions (for example `<` / `^` cells merge table
        cells, and `{빨강}…{/빨강}` colours text), and anything outside it is read as plain text."""
        return syntax_guide()

    @server.tool(title="Check an MDitor document", annotations=_READ)
    def check_markdown(markdown: Markdown) -> dict[str, Any]:
        """Parse a document the way the editor and the PDF renderer do, and report whether it is valid.

        On success returns `ok: true` with the title, counts, an outline (sections and their blocks, each with a
        stable `id`), and — when the input was not already in canonical form — `normalized`, the canonical Markdown
        you should keep using. On failure returns `ok: false` with `error.line` (1-based) and `error.message`
        saying what to fix. Run this after writing or editing, before rendering."""
        doc, result = parsed(markdown)
        if doc is None:
            return result
        out: dict[str, Any] = {"ok": True, "title": doc["title"], "stats": core.stats(doc), "outline": md.outline(doc)}
        if not result["canonical"]:
            out["normalized"] = result["md"]
        return out

    @server.tool(title="Page layout", annotations=_READ)
    async def page_layout(
        markdown: Markdown,
        page_size: PageSize = "A4",
        landscape: Landscape = False,
        margin_mm: MarginMm = 20,
        font_size: FontSize = 10.5,
        section_break: SectionBreak = False,
    ) -> dict[str, Any]:
        """Lay the document out exactly as the PDF renderer does and report where everything lands: total pages,
        the page each section and block starts on, and where a long list or table continues onto the next page
        (`continues`: the 1-based item or body row that starts the new page). Use it to answer "how many pages is
        this?", to check that a table is not split awkwardly, or to decide where to shorten text. The options must
        match the ones you will pass to `render_pdf`."""
        doc, result = parsed(markdown)
        if doc is None:
            return result
        options = _options(page_size, landscape, margin_mm, font_size, section_break)
        try:
            lay = await anyio.to_thread.run_sync(functools.partial(core.layout, doc, options))
        except RenderError as e:
            return _fail(str(e))
        return {"ok": True, **core.page_report(doc, lay)}

    @server.tool(title="Compare two versions", annotations=_READ)
    def diff_markdown(
        before: Annotated[str, Field(description="The document before your edit.")],
        after: Annotated[str, Field(description="The document after your edit.")],
    ) -> dict[str, Any]:
        """Compare two versions of a document block by block. Returns the blocks that were added, modified and
        removed (matched by content, so moving or lightly editing a block keeps its identity), whether the title or
        the section list changed, and `new_numbers` — numbers that appear in `after` but nowhere in `before`. Use it
        after an edit to confirm you changed only what was asked and did not introduce figures without a source."""
        old, result = parsed(before)
        if old is None:
            return {**result, "which": "before"}
        try:
            new = md.apply_md(old, core.clean(after, settings.max_md_chars))
        except md.MdError as e:
            return {**_fail(e.message, e.line), "which": "after"}
        except core.InputError as e:
            return {**_fail(str(e)), "which": "after"}
        changes = md.diff(old, new)
        labels = {b["id"]: b for s in md.outline(new) for b in s["blocks"]}
        return {
            "ok": True,
            "added": [labels[i] for i in changes["added"]],
            "modified": [labels[i] for i in changes["modified"]],
            "removed": changes["removed"],
            "title_changed": changes["title"],
            "sections_changed": changes["sections"],
            "new_numbers": md.new_numbers(before, after),
        }

    if settings.public_url:

        @server.tool(title="Open in the web editor", annotations=_READ)
        def editor_link(markdown: Markdown) -> dict[str, Any]:
            """Make a link that opens this document in the MDitor LaSee web editor, where a person can edit it visually,
            see the page boundaries and download the PDF. The document travels in the URL fragment, so it is not
            uploaded or stored on the server. Give the link to the user when they want to review or hand-edit."""
            doc, result = parsed(markdown)
            if doc is None:
                return result
            return {"ok": True, "url": core.editor_link(settings.public_url, result["md"])}

    async def make_pdf(doc: dict[str, Any], options: dict[str, Any], images: dict[str, bytes]) -> tuple[bytes, dict[str, Any]]:
        return await anyio.to_thread.run_sync(functools.partial(core.pdf, doc, options, images))

    if remote:

        @server.tool(title="Render PDF", annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False))
        async def render_pdf(
            markdown: Markdown,
            filename: Annotated[str | None, Field(description="File name for the download, without extension.")] = None,
            images: Annotated[
                dict[str, str] | None,
                Field(description="Images referenced as `![caption](name)`: name → base64 or data URI (PNG/JPEG)."),
            ] = None,
            page_size: PageSize = "A4",
            landscape: Landscape = False,
            margin_mm: MarginMm = 20,
            font_size: FontSize = 10.5,
            section_break: SectionBreak = False,
            page_numbers: PageNumbers = True,
        ) -> dict[str, Any]:
            """Render the document to PDF and return a download link. The link is temporary — pass it to the user
            or download it right away. Also returns the page count. Run `check_markdown` first; an invalid document returns its error instead."""
            doc, result = parsed(markdown)
            if doc is None:
                return result
            try:
                data, lay = await make_pdf(
                    doc,
                    _options(page_size, landscape, margin_mm, font_size, section_break, page_numbers),
                    core.decode_images(images, settings.max_image_bytes),
                )
            except (RenderError, core.InputError) as e:
                return _fail(str(e))
            token = core.store_download(settings.cache_dir, settings.download_ttl, data)
            name = (filename or doc.get("title") or "document").strip().replace("/", " ")[:80] or "document"
            out: dict[str, Any] = {
                "ok": True,
                "pages": lay["total"],
                "bytes": len(data),
                "download_url": f"{settings.public_url}/d/{token}/{_quote(name)}.pdf",
                "expires_in_seconds": settings.download_ttl,
            }
            return out

    else:

        @server.tool(title="Render PDF", annotations=ToolAnnotations(read_only_hint=False, idempotent_hint=True, open_world_hint=False))
        async def render_pdf(  # type: ignore[misc]
            markdown: Markdown,
            output_path: Annotated[
                str, Field(description="Where to write the PDF, e.g. `./report.pdf`. Must end in .pdf. Overwrites.")
            ],
            base_dir: Annotated[
                str | None,
                Field(description="Folder that relative image paths in the document resolve against. Defaults to the PDF's folder."),
            ] = None,
            page_size: PageSize = "A4",
            landscape: Landscape = False,
            margin_mm: MarginMm = 20,
            font_size: FontSize = 10.5,
            section_break: SectionBreak = False,
            page_numbers: PageNumbers = True,
        ) -> dict[str, Any]:
            """Render the document to a PDF file on this machine. Images written as `![caption](path.png)` are read
            from disk (relative to `base_dir`). Returns the absolute path, page count and size. Run `check_markdown`
            first; an invalid document returns its error instead and writes nothing."""
            doc, result = parsed(markdown)
            if doc is None:
                return result
            target = Path(output_path).expanduser()
            if target.suffix.lower() != ".pdf":
                return _fail("output_path 는 .pdf 로 끝나야 합니다.")
            target = target.resolve()
            if not target.parent.is_dir():
                return _fail(f"폴더가 없습니다: {target.parent}")
            root = Path(base_dir).expanduser().resolve() if base_dir else target.parent
            images: dict[str, bytes] = {}
            missing: list[str] = []
            total = 0
            for s in doc["sections"]:
                for b in s["blocks"]:
                    src = b.get("src") if b["kind"] == "image" else None
                    if not src or src.startswith("data:") or src in images:
                        continue
                    path = (root / src).resolve()
                    if path.suffix.lower() in _IMAGE_SUFFIXES and path.is_file():
                        total += path.stat().st_size
                        if total > settings.max_image_bytes * 4:
                            return _fail("그림이 너무 큽니다.")
                        images[src] = path.read_bytes()
                    else:
                        missing.append(src)
            try:
                data, lay = await make_pdf(
                    doc, _options(page_size, landscape, margin_mm, font_size, section_break, page_numbers), images
                )
            except RenderError as e:
                return _fail(str(e))
            target.write_bytes(data)
            out: dict[str, Any] = {"ok": True, "path": str(target), "pages": lay["total"], "bytes": len(data)}
            if missing:
                out["missing_images"] = missing
            return out

    @server.resource("mditor://syntax", name="syntax", title="MDitor syntax guide", mime_type="text/markdown")
    def syntax_resource() -> str:
        """The MDitor Markdown dialect reference."""
        return syntax_guide()

    @server.resource("mditor://example", name="example", title="Example document", mime_type="text/markdown")
    def example_resource() -> str:
        """A complete example document that uses every feature of the dialect."""
        return example_md()

    @server.prompt(title="Write an MDitor document")
    def write_document(topic: str) -> str:
        """Draft a formal document on a topic in MDitor Markdown and render it."""
        return (
            f"Write a formal document about: {topic}\n\n"
            "Use the MDitor tools. Read `syntax_guide` first, write the document in MDitor Markdown, validate it with "
            "`check_markdown`, look at `page_layout` to make sure tables and lists break sensibly, then call "
            "`render_pdf`. Use only facts I gave you; mark anything you could not verify with `[확인 필요]`."
        )

    return server


def _quote(name: str) -> str:
    return quote(name, safe="")


def main() -> None:
    parser = argparse.ArgumentParser(prog="mditor-mcp", description="MDitor MCP server")
    parser.add_argument("--http", action="store_true", help="stdio 대신 Streamable HTTP 로 띄운다")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = build(remote=False)
    if args.http:
        server.run("streamable-http", host=args.host, port=args.port)
    else:
        server.run("stdio")


if __name__ == "__main__":
    main()

