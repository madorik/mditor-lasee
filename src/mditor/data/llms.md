# MDitor LaSee (MDitor 라씨)

> MDitor LaSee is a web-based Markdown document editor for structured documents such as reports, plans and meeting minutes. You can edit visually like a word processor or edit the Markdown source directly. The page breaks in the preview come from rendering the actual PDF, so they match the PDF you download. The interface is available in Korean and English.

- Documents are stored only in the user's browser (IndexedDB and localStorage). The server processes the text to build previews and PDFs and does not keep it.
- Images added in the editor are uploaded to the service's image storage and deleted automatically after 3 days. Downloaded PDFs contain the images.
- Formatting: bold, italic, underline, strikethrough, highlight, links, inline code, superscript and subscript, text color (red, blue, gray, or any `#rrggbb` color code) and shading; bulleted, numbered and task lists; code blocks; horizontal rules and page breaks; paragraph alignment; tables with merged, aligned and shaded cells; images; an option to start each section on a new page.
- Page setup: A4 or Letter, portrait or landscape, margins, font size 8–14 pt, page numbers. Fonts: Pretendard, Nanum Myeongjo, Nanum Gothic, Nanum Pen Script.
- Exports: PDF, Markdown (.md), and a link that carries the document in the URL fragment.
- Content pasted from Word or Excel keeps only the formatting the document format supports.

## Pages

- [Editor](%PUBLIC_URL%/en/edit): the editor with an English interface ([Korean interface](%PUBLIC_URL%/edit))
- [Home](%PUBLIC_URL%/en/): overview and FAQ ([Korean](%PUBLIC_URL%/))
- [Syntax guide](%PUBLIC_URL%/en/syntax): the Markdown dialect — headings and blocks, inline tags such as `{red}…{/red}` or `{#1f8a5c}…{/#1f8a5c}`, merged table cells written with `<` and `^`, images, and page-break rules ([Korean](%PUBLIC_URL%/syntax))

## Editor library and source

- [npm package `@watalabs/lasee-mditor`](https://www.npmjs.com/package/@watalabs/lasee-mditor): the same document editor as a browser library (MIT). Use it with a bundler (ESM), React, or a single `<script>` tag; `@watalabs/lasee-mditor/core` parses and writes the Markdown dialect without a UI.
- [Source code on GitHub](https://github.com/madorik/mditor-lasee): the web service, the PDF renderer, and the editor package.

## Optional

- [Privacy policy](%PUBLIC_URL%/en/privacy) ([Korean](%PUBLIC_URL%/privacy))
- [Terms of use](%PUBLIC_URL%/en/terms) ([Korean](%PUBLIC_URL%/terms))
