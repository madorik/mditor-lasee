# @watalabs/lasee-mditor

A WYSIWYG Markdown document editor: **edit what you see, keep Markdown as the source of truth.**
It is the editor from [MDitor LaSee](https://lasee.watalabs.com/en/), packaged as a library. It runs entirely in the browser — no server needed.

- Framework-free core, an optional **React** wrapper, and a `<script>` bundle (UMD)
- English and Korean UI (every string can be replaced)
- The output Markdown is always one canonical form: the same document gives the same Markdown, byte for byte the same as the MDitor server that renders the PDF

**Source:** [github.com/madorik/mditor-lasee](https://github.com/madorik/mditor-lasee/tree/main/web/packages/lasee-mditor) · **License:** MIT

## Features

- **Toolbar** — undo/redo · block type (body, heading, subheading, list, note, code block, document title) · bold · italic · underline · strikethrough · text color (palette or color code) · shade · highlight · link · inline code · superscript/subscript · clear formatting · bulleted, numbered and to-do lists · indent/outdent · paragraph alignment · tables (pick a size) · images (URL, file, paste, drag and drop) · code block · horizontal line · page break · special characters · find and replace · Markdown source mode · preview on/off · full screen
- **Tables** — insert/delete rows and columns, merge and split cells, cell shading, column alignment (a table toolbar appears when the cursor is in a table), **images inside cells**
- **Images** — resize by dragging the corner handle or with 25 · 50 · 75 · 100% · original-size buttons; drag to move, between the body and table cells. The width is kept in Markdown as `{width=N%}`
- **Input rules** — `- ` bullets, `1. ` numbers, `[ ] ` to-dos, `## ` `### ` headings, `> ` note, ```` ``` ```` code block, `---` line, `**bold**`, `==highlight==`, `` `code` ``
- **Smart paste** — pasted Markdown is parsed into the document (Shift-paste keeps plain text). Tables, lists and links pasted from Word or Google Docs are kept.
- **Paste limits** — cap the characters per paste and the document length, so one huge paste can't freeze the page or your server
- **Status bar** with character and word counts · **read-only mode** · **automatic page-break marks** fed by your own page layout

## How it compares to CKEditor

CKEditor is a general-purpose rich-text editor for HTML content. LaSee MDitor is built for structured documents — reports, plans, meeting minutes — where **Markdown is the stored format** and **the pages on screen must match the PDF**.

| | CKEditor 5 | LaSee MDitor |
|---|---|---|
| **Source format** | HTML. Markdown through a plugin (GFM); formatting GFM can't express falls back to HTML or is dropped | Markdown itself — text color, shading, merged cells, paragraph alignment and page breaks are all Markdown syntax |
| **Output** | The same content can produce different HTML | One canonical Markdown per document, so git diffs and AI edits stay clean |
| **Pages that match the PDF** | Premium pagination plus cloud PDF export | The MDitor server renders the real PDF and reports where pages break; the editor draws those marks in place |
| **AI** | Premium AI Assistant, working on HTML | MDitor's MCP server lets agents write, check, lay out and export the very same Markdown |
| **Without a UI** | Editor-centric | `@watalabs/lasee-mditor/core` parses, writes and renders HTML in Node or a worker — byte-identical with the Python server |
| **License** | GPL or a commercial license; many features are premium | MIT, free, no license key |
| **Korean** | One of many UI languages | Korean IME input tested end to end, Korean tag names, Korean fonts in the PDF |

**Choose CKEditor** if you need real-time collaboration, comments, track changes or revision history; free-form formatting (font families and sizes, nested tables, embedded media, math); Word import and export; or a long-established ecosystem with commercial support.

Good to know: this package doesn't compute pages by itself — page marks come from the MDitor server (the public API or your own). The extended syntax (`{red}`, `<` and `^` for merged cells) shows up as plain text in ordinary Markdown viewers.

## Install

```bash
npm install @watalabs/lasee-mditor
```

## Usage

### Plain JavaScript / TypeScript (ESM)

```ts
import { createMDitor } from "@watalabs/lasee-mditor";
import "@watalabs/lasee-mditor/style.css";

const mditor = createMDitor({
  element: document.querySelector("#mditor")!,
  markdown: "# Title\n\nBody text\n",
  locale: "en",          // UI language: "en" | "ko" (default "ko")
  preview: true,         // open the preview pane (users toggle it from the toolbar)
  maxPaste: 5000,        // reject pastes longer than 5,000 characters
  onChange: (md) => console.log(md),
});

mditor.getMarkdown();
mditor.setMarkdown("## New text\n");
```

Give the editor a height — it fills its container (`.mde` is a flex column with a minimum height of 320px):

```css
#mditor .mde { height: 600px; }
```

### One `<script>` tag (UMD)

```html
<link rel="stylesheet" href="https://unpkg.com/@watalabs/lasee-mditor/dist/style.css" />
<script src="https://unpkg.com/@watalabs/lasee-mditor/dist/lasee-mditor.umd.js"></script>

<div id="mditor" style="height: 600px"></div>
<script>
  const mditor = LaSeeMDitor.createMDitor({
    element: document.getElementById("mditor"),
    markdown: "# Hello\n",
    locale: "en",
  });
</script>
```

The bundle defines the global `LaSeeMDitor` with everything the ESM entry exports. Pin a version in production (`…/lasee-mditor@0.2.1/dist/…`).

### React

```tsx
import { useState } from "react";
import { MDitorView } from "@watalabs/lasee-mditor/react";
import "@watalabs/lasee-mditor/style.css";

function Page() {
  const [md, setMd] = useState("# Title\n");
  return <MDitorView value={md} onChange={setMd} locale="en" preview style={{ height: 600 }} />;
}
```

`react` and `react-dom` are optional peer dependencies — install them yourself. A `ref` gives you the `MDitor` instance. Use `toolbarStart` / `toolbarEnd` to put your own buttons at either end of the toolbar. The editor is created once; later prop changes follow `value`, `editable`, `dialect` and `preview` (change the `key` to recreate it with other options).

### No UI — parse, write, render HTML

```ts
import { parseMarkdown, docToMarkdown, renderHtml } from "@watalabs/lasee-mditor/core"; // no TipTap, no DOM

const doc = parseMarkdown(md);   // Markdown → document (JSON); throws MdError(line, code) on invalid input
docToMarkdown(doc);              // document → canonical Markdown
renderHtml(md);                  // Markdown → HTML (only safe link URLs)
```

Works on a server or in a worker.

## Options

| Name | Default | Description |
|---|---|---|
| `element` | (required) | Element to mount the editor in |
| `markdown` / `doc` | `""` | Initial content (Markdown, or a document JSON) |
| `locale` | `"ko"` | UI language, `"en"` or `"ko"` |
| `messages` | | Override UI strings (`Partial<Messages>`) |
| `dialect` | auto | Formatting tag names — `{red}` or `{빨강}`. Defaults to the first tag found in the Markdown, otherwise `locale` |
| `toolbar` | `DEFAULT_TOOLBAR` | Toolbar items; `false` for no toolbar |
| `preview` | `false` | Open the preview pane |
| `pageMarks` | `false` | Show page-break marks from the start (you supply them with `setPageMarks`) |
| `mode` | `"wysiwyg"` | Initial mode; `"source"` for the Markdown source |
| `statusbar` | `true` | Character and word counts |
| `editable` | `true` | Allow editing |
| `placeholder` | | Hint shown in an empty document |
| `contentClass` | `"mde-doc"` | Class of the document area (to use your own document styles) |
| `image.upload` | data: URL | `(file) => Promise<url>` — upload a file and return the URL to write in the document |
| `image.resolve` | as written | Map an image name in the document to the URL to display |
| `image.onFiles` / `image.pick` | | Handle image files / the image button yourself |
| `onChange` | | `(markdown, mditor) => void` |
| `maxPaste` | none | Characters allowed in one paste; longer pastes are rejected |
| `maxLength` | none | Document (Markdown) length limit; pastes that would exceed it are rejected. Typing is never blocked |
| `onTooLong` | a notice above the editor | `({ kind: "paste" \| "document", length, max }) => void` — called when a paste is rejected |
| `extensions` | | Extra TipTap extensions |

### Toolbar items

`undo` `redo` `blockKind` `bold` `italic` `underline` `strike` `color` `highlight` `link` `code` `superscript` `subscript` `removeFormat`
`bulletList` `orderedList` `taskList` `outdent` `indent` `align` `table` `image` `codeBlock` `horizontalRule` `pageBreak` `specialChars`
`find` `source` `preview` `fullscreen` `pageMarks` (not in the default toolbar), the separator `"|"`, and custom items `{ name, render: (mditor) => HTMLElement }`.

```ts
createMDitor({
  element,
  toolbar: ["bold", "italic", "|", "link", "|", "preview", { name: "save", render: () => mySaveButton }],
});
```

## The `MDitor` instance

| Method | |
|---|---|
| `getMarkdown()` · `setMarkdown(md)` | Read or replace the Markdown (`setMarkdown` throws `MdError` on invalid Markdown) |
| `getDoc()` · `setDoc(doc)` · `getHTML()` | Document JSON · the preview HTML |
| `setMode("wysiwyg" \| "source")` · `getMode()` | Switch between the document and the Markdown source. Returns `false` and shows the error line if the source can't be parsed |
| `setPreview(on)` · `isPreview()` | Show or hide the preview |
| `setPageMarks(marks)` · `setPageMarksVisible(on)` · `isPageMarksVisible()` | Automatic page-break marks |
| `setFullscreen(on)` · `setEditable(on)` · `setDialect(d)` | |
| `insertImage(src, caption?)` · `replaceImage(from, to)` · `refreshImages()` | Images |
| `on("change" \| "mode" \| "preview" \| "fullscreen" \| "pagemarks", fn)` | Events; returns an unsubscribe function |
| `slot("start" \| "end")` | Empty slots at either end of the toolbar for your own buttons |
| `focus()` · `destroy()` | |
| `tiptap` | The underlying TipTap `Editor` |

**Shortcuts** (Ctrl instead of ⌘ on Windows/Linux): bold ⌘B · italic ⌘I · underline ⌘U · code ⌘E · link ⌘K · highlight ⌘⇧H · superscript/subscript ⌘. / ⌘, · numbered/bulleted/to-do list ⌘⇧7 / 8 / 9 · body/heading/subheading ⌘⌥0 / 2 / 3 · page break ⌘Enter · find ⌘F · indent Tab / ⇧Tab.

### Automatic page-break marks

The editor never guesses where pages end — you compute that and pass it in. (The MDitor server's `POST /api/md/preview-pages` returns the layout of the actual PDF.) Positions use indexes into the document JSON; the editor groups blocks by the same rules, so the indexes match.

```ts
mditor.setPageMarks({
  total: 4,
  sections: { 2: 3 },                         // the third section (## …) starts on page 3
  blocks: {
    0: { items: { 12: 2 } },                  // in the first block (a list), page 2 starts at the 13th item
    5: { rows: { 30: 4 } },                   // in the sixth block (a table), page 4 starts at the 31st body row
    7: { before: 4 },                         // a new page starts before the eighth block
  },
});
mditor.setPageMarksVisible(true);             // or the "pageMarks" toolbar item
```

Until new marks arrive, existing marks follow the text as it's edited. Marks are never written to the Markdown. While they're on, the status bar shows the page count.

## Syntax

A subset of CommonMark/GFM plus MDitor's report syntax. Any Markdown viewer can still read it.

```markdown
# Document title
## Heading (section)
### Subheading (block title)

**bold** ~~strike~~ ==highlight== `code` [link](https://example.com) H<sub>2</sub>O x<sup>2</sup>
{italic}italic{/italic} {underline}underline{/underline} {shade}shade{/shade} {red}red{/red} {#2e8b57}any color{/#2e8b57}
{center}A centered paragraph{/center}   ← also {right} {justify}

- Bullet
  - Nested (up to 3 levels)
1. Numbered
- [ ] To-do
- [x] Done
> Note (small text under the block)

| Head | Merged head | < |
| ^ | Left | Right |
|:---|:---|---:|
| Cell | {shade}Shaded cell{/shade} | 1 |

![Caption](image.png){width=60%}      ← width: % of the body width (optional)

---                     ← horizontal line
<!-- pagebreak -->      ← page break (PDF)
```

Code blocks use ```` ``` ```` fences with an optional language.

- Tags: `{red}` `{blue}` `{gray}` or any `{#rrggbb}`, `{italic}` `{underline}` `{shade}`, `{center}` `{right}` `{justify}`. Each also has a Korean name (`{빨강}` = `{red}`, `{가운데}` = `{center}`); a document uses one set.
- In tables, `<` merges a cell into the one on its left and `^` into the one above.
- Images can go inside table cells: `| ![Photo](a.png){width=40%} |` — the width is a % of the cell width, and the image takes a line of its own in the cell. To write `![` as text in a cell, escape it: `\![`.
- Escape a symbol with `\` to write it literally: `\*\*`, `\[`, `` \` ``, `1\.`.
- Not supported: `*italic*` (use `{italic}`), headings below `###`, footnotes, math, video.

Full guide: [lasee.watalabs.com/en/syntax](https://lasee.watalabs.com/en/syntax).

## Styling

Every class starts with `.mde`. Colors and fonts are CSS variables:

```css
.my-app .mde {
  --mde-accent: #6d28d9;
  --mde-font: "Inter", sans-serif;
  --mde-doc-width: 720px;
  --mde-min-height: 480px;
}
```

To style the document area yourself, pass `contentClass: "my-doc"` and style `h1 h2 h3 p .md-list li[data-num] .md-check table pre code hr .md-pagebreak .md-note mark.md-mark` under that class.

## Development

The package lives in the [mditor-lasee](https://github.com/madorik/mditor-lasee) repository under `web/packages/lasee-mditor`.

```bash
cd web/packages/lasee-mditor
npm run build      # dist/: index.js · core.js · react.js (ESM), lasee-mditor.umd.js, style.css, types/
npm run dev        # demo/ — try it without a server
cd ../.. && npx vitest run packages   # tests, including the fixture shared with the server
```

| Path | Contents |
|---|---|
| `src/core/` | Inline formatting, Markdown parse/write, HTML — the **same rules** as the server's `src/mditor/inline.py` and `md.py` (change both) |
| `src/pm/` | TipTap schema, document ↔ editor conversion, commands, plugins (list numbers, find, page marks) |
| `src/ui/` | Toolbar, popovers, find and replace, source mode, preview, UI strings |
| `src/react.tsx` | React wrapper |
| `src/fixture.json` | Shared fixture generated by the server tests (`tests/test_fixture.py`) |

Publishing: `npm publish` from this folder (it builds first via `prepublishOnly`; check the contents with `npm pack --dry-run`). The `watalabs` npm account uses two-factor auth, so add `--otp=<code>`.

## License

[MIT](LICENSE) © WataLabs
