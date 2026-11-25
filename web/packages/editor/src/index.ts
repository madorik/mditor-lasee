// @mditor/editor — Markdown 문서 편집기(보이는 모양 그대로 고치고, 원본은 MD).
//
//   import { createEditor } from "@mditor/editor";
//   import "@mditor/editor/style.css";
//   const editor = createEditor({ element: document.querySelector("#editor")!, markdown: "# 제목\n", onChange: (md) => … });
//
// 화면 없이 MD 를 읽고 쓰기만 하려면 "@mditor/editor/core" 를 쓴다.

export * from "./core";
export { createEditor, DEFAULT_TOOLBAR, type MarkdownEditor, type MarkdownEditorOptions, type ToolbarItem, type ImageOptions, type EditorMode } from "./ui/editor";
export { messagesFor, ko as messagesKo, en as messagesEn, type Messages, type Locale } from "./ui/messages";
export { richExtensions, colorName, type RichOptions, type ImageResolver } from "./pm/schema";
export { toPM, fromPM, pmToDoc, inlineToPM, inlineToMd, titleToMd, tableData, tableMd } from "./pm/convert";
export * as commands from "./pm/commands";
export { ListNumbers, FindReplace, PageMarksExtension, listNumbers, findKey, pageMarkPlaces, pageMarksKey, type PageMarks, type PagePlace } from "./pm/plugins";
export type { DocTrace } from "./pm/convert";
