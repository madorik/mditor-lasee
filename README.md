# MDitor LaSee

English · [한국어](README.ko.md)

A document editor for structured documents — reports, plans, meeting minutes. You edit what you see, like in a word processor, while the source stays plain **Markdown** (so an AI can edit the same text). The page breaks in the preview come from rendering the real PDF, so **what you see is the PDF you download**.

| | |
|---|---|
| **Web app** | [lasee.watalabs.com/en](https://lasee.watalabs.com/en/) (English) · [lasee.watalabs.com](https://lasee.watalabs.com) (Korean). No sign-up; documents stay in your browser. |
| **Editor library** | [`@watalabs/lasee-mditor`](https://www.npmjs.com/package/@watalabs/lasee-mditor) on npm — the same editor for your own app (MIT). |
| **MCP server** | AI agents write documents, check the syntax, check the page layout, and export PDFs. |
| **HTTP API** | The same features over plain HTTP. |

All of them share one parser and one renderer, so the pages a person sees, the pages an agent sees, and the pages in the PDF are the same.

## Use the editor in your app

```bash
npm install @watalabs/lasee-mditor
```

```ts
import { createMDitor } from "@watalabs/lasee-mditor";
import "@watalabs/lasee-mditor/style.css";

const mditor = createMDitor({
  element: document.querySelector("#mditor")!,
  markdown: "# Meeting notes\n\n- First item\n",
  locale: "en",    // UI language: "en" | "ko"
  preview: true,   // open the preview pane (users can toggle it in the toolbar)
  onChange: (md) => save(md),
});

mditor.getMarkdown(); // the edited document as Markdown
mditor.getHTML();     // the same HTML as the preview
```

It runs entirely in the browser — no server needed. You can also use it from React (`@watalabs/lasee-mditor/react`), with a single `<script>` tag (UMD build), or without any UI to parse and write the Markdown dialect (`@watalabs/lasee-mditor/core`).

Full guide — options, API, toolbar, styling: [`web/packages/lasee-mditor/README.md`](web/packages/lasee-mditor/README.md).

## Use the web app

Open [the editor](https://lasee.watalabs.com/en/edit) and start writing.

- **Edit** on the left: the *Document* tab works like a word processor; the *MD* tab shows the Markdown source. Both edit the same text.
- **Check** on the right: the *Preview* shows the pages exactly as the PDF lays them out, or open the *PDF* itself. You can hide the preview, and turn on *Automatic page breaks* to see the same page boundaries inside the document tab.
- **Export** a PDF (A4 or Letter, portrait or landscape, margins, font size, page numbers, four free fonts), a `.md` file, or a link that carries the whole document in the URL fragment (nothing is stored on the server).
- Documents and their saved versions live in your browser (IndexedDB). Images you add are kept for 3 days on the service's image storage; downloaded PDFs contain them.

## Connect an AI agent (MCP)

Register one URL — no authentication.

```bash
claude mcp add --transport http mditor https://lasee.watalabs.com/mcp
```

```json
{ "mcpServers": { "mditor": { "type": "http", "url": "https://lasee.watalabs.com/mcp" } } }
```

The transport is Streamable HTTP and the server is stateless. To run it locally over stdio instead (writes PDFs straight to disk and reads image files referenced in the document; no network):

```bash
uvx --from git+https://github.com/madorik/mditor-lasee mditor-mcp
```

| Tool | What it does |
|---|---|
| `syntax_guide` | Returns the full syntax. Read it once before writing. |
| `check_markdown` | Parses a document: its outline and canonical Markdown, or the line and what to fix. |
| `page_layout` | Renders the PDF and reports the page count, which page each section and block lands on, and where long tables and lists break. |
| `render_pdf` | Builds the PDF — a file (local) or a download link valid for 30 minutes (remote). |
| `diff_markdown` | Compares two versions block by block and points out new numbers. |
| `editor_link` | A link that opens the document in the web editor. |

Try asking your agent: *“Write a Q3 operations report with MDitor. Read the syntax first, check it when you're done, make sure no table breaks awkwardly mid-page, and export a PDF.”*

## HTTP API

Request bodies are JSON. Nothing is stored.

| Call | Returns |
|---|---|
| `POST /api/md/preview` | The parsed document (JSON) and canonical Markdown, or `{ok: false, error: {line, message}}` |
| `POST /api/md/preview-pages` | Page layout: the page of every section, block, list item and table row, and the page count |
| `POST /api/md/pdf` | The PDF file. The page count is in the `X-Mditor-Pages` header |

```bash
curl -X POST https://lasee.watalabs.com/api/md/pdf \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en" \
  -d '{"md": "# Report\n\n## 1. Summary\n\n- First item\n", "options": {"page": "A4"}}' \
  -o report.pdf
```

`options`: `page` (`A4`, `Letter`), `landscape`, `margin_mm` (8–40), `font_size` (8–14), `font` (`pretendard`, `nanum-myeongjo`, `nanum-gothic`, `nanum-pen`), `section_break`, `page_numbers`. Send images as `images: {name: data URI}`. `Accept-Language: en` returns error messages in English and makes new formatting tags English (`{red}` instead of `{빨강}`).

The public service has limits — 400,000 characters per document, 8 MB of images per request, and a per-IP request rate (`429` / `413` when exceeded). For heavy use, run your own server.

## The Markdown dialect

A subset of CommonMark/GFM plus a few report-friendly tags. Any Markdown viewer can still read it.

```markdown
# Document title
## 1. Section
### Block title
- Item with **bold**, ~~strike~~, ==highlight==, `code`, [a link](https://example.com), x<sup>2</sup>
  - Sub-item (up to 3 levels)
- {italic}italic{/italic} {underline}underline{/underline} {red}red{/red} {#2e8b57}any color{/#2e8b57} {shade}shade{/shade}
1. Numbered
- [ ] To-do
> A note (small text under the block)

{center}A centered paragraph{/center}

| Field | Revenue | < |
| ^ | Print | E-book |
|:---|---:|---:|
| Fiction | {shade}412{/shade} | 96 |

![Caption](image.png)

---
<!-- pagebreak -->
```

`<` merges a cell into the one on its left, `^` into the one above. Every tag also has a Korean name (`{빨강}` = `{red}`, `{가운데}` = `{center}`); a document uses one or the other. Full guide: [lasee.watalabs.com/en/syntax](https://lasee.watalabs.com/en/syntax).

## Run your own server

You need Python 3.10+ (3.12 recommended) with [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
uv sync --all-extras                       # server
cd web && npm install && npm run build     # front end → web/dist
cd .. && uv run mditor-server              # http://localhost:8000
```

Or as one container:

```bash
docker build -t mditor .
docker run -p 8000:8000 --env-file .env mditor
```

Copy `.env.example` to `.env`. The only required setting is `MDITOR_PUBLIC_URL` (your public address, no trailing `/`). Optional:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on “Edit with AI” (`MDITOR_AI_MODEL`, `MDITOR_AI_DAILY_LIMIT`, `MDITOR_AI_MAX_MD_CHARS` tune it) |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | Store uploaded images in Cloudflare R2 (all four) |
| `MDITOR_IMAGE_DIR` | Store uploaded images in a local folder instead |
| `MDITOR_RATE_PER_MINUTE` | Requests per minute per IP (preview, PDF, MCP) |
| `MDITOR_MAX_MD_CHARS` / `MDITOR_MAX_PASTE_CHARS` | Document length limit (400,000) / characters per paste in the editor (5,000) |
| `MDITOR_TRUST_PROXY` | `1` behind a proxy — count IPs from `X-Forwarded-For` |

The server keeps no documents, so it needs no disk (MCP-generated PDFs stay in `/tmp` for 30 minutes). Every variable is described in `.env.example`.

## Development

```bash
cd web && npm run dev          # front end on http://localhost:5173, proxies /api to :8000
uv run pytest                  # server: syntax round-trips, page layout ↔ PDF, API, MCP
cd web && npm test             # front end + editor package (same output as the server)
cd web && npm run typecheck
```

The server (`src/mditor/inline.py`, `md.py`) and the editor package (`web/packages/lasee-mditor/src/core/`) implement the same Markdown rules and must produce byte-identical output. A shared fixture checks this; regenerate it after changing the syntax:

```bash
MDITOR_WRITE_FIXTURE=1 uv run pytest tests/test_fixture.py
```

| Path | Contents |
|---|---|
| `src/mditor/` | Parser and writer, PDF renderer (reportlab) with page layout, FastAPI server, MCP server |
| `src/mditor/data/syntax.md` | The syntax guide served to agents |
| `web/packages/lasee-mditor/` | The editor package `@watalabs/lasee-mditor` (core rules, TipTap schema, UI, React wrapper) |
| `web/src/` | The web app (editor screen, page preview, landing pages) |
| `web/e2e/` | Headless Chrome scripts that drive the real editor |

## License

The editor package (`web/packages/lasee-mditor`) is [MIT](web/packages/lasee-mditor/LICENSE). The bundled fonts are under the SIL Open Font License 1.1 (`src/mditor/fonts/OFL-*.txt`).
