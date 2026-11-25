// 편집기 화면 — 프레임워크 없이 쓰는 Markdown 편집기.
//
//   const editor = createEditor({ element, markdown, onChange: (md) => … });
//
// 도구 막대 · 찾아 바꾸기 · 표/코드 도구 · MD 원문 보기 · 미리보기(켜고 끄기) · 전체 화면 · 글자 수를 갖춘다.

import { Editor, Extension, InputRule, type AnyExtension, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Slice, type ResolvedPos } from "@tiptap/pm/model";
import type { Command, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { renderHtml } from "../core/html";
import { dialectOf, type Dialect } from "../core/inline";
import { parseMarkdown } from "../core/parse";
import { MdError, type Doc } from "../core/types";
import {
  addRowAbove,
  addRowBelow,
  blockKind,
  insertPageBreak,
  listKind,
  mergeSafe,
  paragraphAlign,
  setBlockKind,
  setColumnAlign,
  setListKind,
  setParagraphAlign,
  shiftItem,
  toggleCellShade,
  type BlockKind,
  type ListKind,
  type ParagraphAlign,
} from "../pm/commands";
import { fromPM, pmToDoc, toPM } from "../pm/convert";
import { FindReplace, findKey, PageMarksExtension, replaceAll, replaceOne, setFind, setPageMarksMeta, stepFind, type PageMarks } from "../pm/plugins";
import { richExtensions } from "../pm/schema";
import { h, popover, type PopoverHost } from "./dom";
import { icon } from "./icons";
import { fill, messagesFor, type Locale, type Messages } from "./messages";
import { ALIGNS, alignPanel, colorGlyph, colorPanel, imagePanel, linkPanel, specialCharsPanel, tableGrid } from "./panels";

export type EditorMode = "wysiwyg" | "source";

/** 도구 막대 항목 — 이름(아래 DEFAULT_TOOLBAR 참고), "|"(구분선), 또는 직접 그리는 항목. */
export type ToolbarItem = string | { name: string; render: (editor: MarkdownEditor) => HTMLElement };

export const DEFAULT_TOOLBAR: ToolbarItem[] = [
  "undo", "redo", "|",
  "blockKind", "|",
  "bold", "italic", "underline", "strike", "color", "highlight", "|",
  "link", "code", "superscript", "subscript", "removeFormat", "|",
  "bulletList", "orderedList", "taskList", "outdent", "indent", "align", "|",
  "table", "image", "codeBlock", "horizontalRule", "pageBreak", "specialChars", "|",
  "find", "source", "preview", "fullscreen",
];

export type ImageOptions = {
  /** 문서에 적힌 그림 이름 → 화면에 그릴 주소. 없으면 적힌 그대로 쓴다. */
  resolve?: (src: string) => string | undefined;
  /** 파일을 올리고 문서에 적을 주소를 돌려준다. 없으면 data: 주소로 넣는다. */
  upload?: (file: File) => Promise<string>;
  /** 그림 파일(붙여넣기 · 끌어다 놓기 · 단추)을 쓰는 쪽이 직접 다룬다 — 이것이 있으면 upload 는 쓰지 않는다. */
  onFiles?: (files: File[]) => void;
  /** 이미지 단추를 누르면 부른다(쓰는 쪽의 파일 고르기). 없으면 주소 · 파일 팝업을 연다. */
  pick?: () => void;
};

export type MarkdownEditorOptions = {
  /** 편집기를 넣을 요소. */
  element: HTMLElement;
  /** 처음 열 MD. */
  markdown?: string;
  /** 처음 열 문서(JSON) — markdown 대신. */
  doc?: Doc;
  /** 화면 글 언어(기본 ko). */
  locale?: Locale;
  /** 화면 글 바꾸기. */
  messages?: Partial<Messages>;
  /** 서식 태그를 쓸 언어({빨강} · {red}). 주지 않으면 MD 에 처음 나오는 태그, 없으면 locale. */
  dialect?: Dialect;
  /** 도구 막대 항목. false 면 도구 막대를 그리지 않는다. */
  toolbar?: ToolbarItem[] | false;
  /** 미리보기 창을 처음부터 연다(기본 false). 도구 막대의 '미리보기' 단추로 켜고 끈다. */
  preview?: boolean;
  /**
   * 자동 쪽 나눔(쪽 경계)을 처음부터 보인다(기본 false). 경계 자리는 쓰는 쪽이 setPageMarks 로 넘긴다 —
   * 편집기는 쪽을 짐작하지 않는다. 도구 막대 항목 "pageMarks" 로 켜고 끈다.
   */
  pageMarks?: boolean;
  /** 처음 모드 — 문서(wysiwyg) 또는 MD 원문(source). */
  mode?: EditorMode;
  /** 글자 수 줄(기본 true). */
  statusbar?: boolean;
  /** 고칠 수 있는가(기본 true). */
  editable?: boolean;
  /** 빈 문서에 보일 안내 글. */
  placeholder?: string;
  /** 문서 영역에 붙일 class(기본 "mde-doc" — 라이브러리의 문서 모양). */
  contentClass?: string;
  image?: ImageOptions;
  /** 글이 바뀔 때마다(MD). */
  onChange?: (markdown: string, editor: MarkdownEditor) => void;
  /**
   * 문서(MD) 길이 한도. 붙이면 이 길이를 넘는 붙여넣기는 받지 않는다(한 번에 큰 글을 붙여 서버 · 브라우저가 무거워지지 않게).
   * 손으로 치는 글은 막지 않는다.
   */
  maxLength?: number;
  /** 한 번에 붙여 넣을 수 있는 글자 수. 넘는 붙여넣기는 받지 않는다(나눠서 붙이게). */
  maxPaste?: number;
  /** maxPaste · maxLength 때문에 붙여넣기를 막았을 때(kind: 어느 한도인지). 주지 않으면 편집기 위 줄에 알린다. */
  onTooLong?: (info: { kind: "paste" | "document"; length: number; max: number }) => void;
  /** 더 붙일 TipTap 확장. */
  extensions?: AnyExtension[];
};

type Events = { change: (md: string) => void; mode: (mode: EditorMode) => void; preview: (on: boolean) => void; fullscreen: (on: boolean) => void; pagemarks: (on: boolean) => void };

export interface MarkdownEditor {
  /** 속의 TipTap 편집기. */
  readonly tiptap: Editor;
  readonly element: HTMLElement;
  readonly messages: Messages;
  getMarkdown(): string;
  /** MD 로 바꾼다. 읽을 수 없는 MD 면 MdError 를 던진다. */
  setMarkdown(markdown: string): void;
  getDoc(): Doc;
  setDoc(doc: Doc): void;
  /** 미리보기와 같은 HTML. */
  getHTML(): string;
  insertImage(src: string, caption?: string): void;
  /** 문서 안의 그림 주소를 바꾼다(null 이면 그 그림을 뺀다). 되돌리기 기록에 남기지 않는다. */
  replaceImage(from: string, to: string | null): void;
  /** 그림 주소 풀이(resolve)가 바뀌었을 때 그림을 다시 그린다. */
  refreshImages(): void;
  getMode(): EditorMode;
  /** 모드를 바꾼다. MD 원문 → 문서가 실패하면(읽을 수 없는 MD) false. */
  setMode(mode: EditorMode): boolean;
  isPreview(): boolean;
  setPreview(on: boolean): void;
  /** 쪽 경계 자리를 넘긴다(null 이면 지운다). 새 경계가 오기 전까지는 글을 고쳐도 경계가 글을 따라 움직인다. */
  setPageMarks(marks: PageMarks | null): void;
  isPageMarksVisible(): boolean;
  setPageMarksVisible(on: boolean): void;
  isFullscreen(): boolean;
  setFullscreen(on: boolean): void;
  setEditable(on: boolean): void;
  setDialect(dialect: Dialect): void;
  /** 도구 막대의 앞 · 뒤 빈칸 — 쓰는 쪽의 단추를 넣는다. */
  slot(name: "start" | "end"): HTMLElement;
  focus(): void;
  on<K extends keyof Events>(event: K, fn: Events[K]): () => void;
  destroy(): void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
const key = (k: string) => (IS_MAC ? `⌘${k.replace("Shift+", "⇧").replace("Alt+", "⌥")}` : `Ctrl+${k}`);
const looksLikeMd = /\n|^#{1,6}\s|^[-*+]\s|^\d{1,9}[.)]\s|^>|\*\*|~~|==|`|\[[^\]]*\]\([^)]*\)|\{\/?[^}\s]+\}|^\|/;

function imageFiles(data: DataTransfer | null): File[] {
  return data ? [...data.files].filter((f) => f.type.startsWith("image/")) : [];
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function createEditor(options: MarkdownEditorOptions): MarkdownEditor {
  const msg = messagesFor(options.locale ?? "ko", options.messages);
  const contentClass = options.contentClass ?? "mde-doc";
  const localeDialect: Dialect = options.locale === "en" ? "en" : "ko";
  const img = options.image ?? {};
  let dialect: Dialect = options.dialect ?? (options.doc?.dialect ?? (options.markdown ? dialectOf(options.markdown) : null) ?? localeDialect);
  const dialectFixed = !!options.dialect;
  let mode: EditorMode = "wysiwyg";
  let previewOn = !!options.preview;
  let fullscreen = false;
  let marksVisible = !!options.pageMarks;
  let pageMarks: PageMarks | null = null;
  const pops: PopoverHost = { current: null };
  const listeners: { [K in keyof Events]: Set<Events[K]> } = { change: new Set(), mode: new Set(), preview: new Set(), fullscreen: new Set(), pagemarks: new Set() };
  const emit = <K extends keyof Events>(k: K, ...args: Parameters<Events[K]>) => listeners[k].forEach((fn) => (fn as (...a: unknown[]) => void)(...args));

  // ───── 뼈대
  const root = h("div", { className: "mde", attrs: { "data-mode": "wysiwyg" } });
  const toolbar = h("div", { className: "mde-toolbar", attrs: { role: "toolbar", "aria-label": msg.toolbar } });
  const slots = { start: h("span", { className: "mde-slot start" }), end: h("span", { className: "mde-slot end" }) };
  const findbar = h("div", { className: "mde-findbar", attrs: { role: "search", "aria-label": msg.findReplace } });
  findbar.hidden = true;
  const context = h("div", { className: "mde-context" });
  const errorBar = h("div", { className: "mde-error", attrs: { role: "alert" } });
  errorBar.hidden = true;
  const mount = h("div", { className: "mde-mount" });
  const scroll = h("div", { className: "mde-scroll" }, mount);
  const source = h("textarea", { className: "mde-source", attrs: { spellcheck: "false", "aria-label": msg.sourceLabel } });
  source.hidden = true;
  const editPane = h("div", { className: "mde-pane mde-edit" }, scroll, source);
  const previewDoc = h("article", { className: `mde-preview-doc ${contentClass}`, attrs: { "aria-label": msg.previewLabel } });
  const previewPane = h("div", { className: "mde-pane mde-preview" }, h("div", { className: "mde-scroll" }, previewDoc));
  const main = h("div", { className: "mde-main" }, editPane, previewPane);
  const status = h("div", { className: "mde-status", attrs: { "aria-live": "polite" } });
  if (options.toolbar !== false) root.append(toolbar);
  root.append(findbar, context, errorBar, main);
  if (options.statusbar !== false) root.append(status);
  options.element.append(root);

  const resolveImage = (src: string) => (img.resolve ? img.resolve(src) : src || undefined);

  // ───── 처음 내용
  let initialError: MdError | null = null;
  let content: JSONContent;
  if (options.doc) content = toPM(options.doc);
  else {
    try {
      content = toPM(parseMarkdown(options.markdown ?? "", dialect));
    } catch (e) {
      if (!(e instanceof MdError)) throw e;
      initialError = e;
      content = toPM({ title: "", sections: [] });
    }
  }

  // ───── 파일
  /**
   * 붙여넣기를 받을 수 있는가 — 한 번에 붙이는 글(added)이 maxPaste 를 넘거나, 붙인 뒤 문서(next)가 maxLength 를 넘으면
   * 알리고 true. 문서를 줄이는 붙여넣기(고른 글을 짧은 글로 바꾸기)는 막지 않는다.
   */
  let tooLongTimer = 0;
  const blocksPaste = (added: number, next: number, now: number): boolean => {
    let info: { kind: "paste" | "document"; length: number; max: number } | null = null;
    if (options.maxPaste && added > options.maxPaste) info = { kind: "paste", length: added, max: options.maxPaste };
    else if (options.maxLength && next > options.maxLength && next > now) info = { kind: "document", length: next, max: options.maxLength };
    if (!info) return false;
    if (options.onTooLong) options.onTooLong(info);
    else {
      errorBar.textContent = fill(info.kind === "paste" ? msg.pasteTooLong : msg.tooLong, { max: info.max.toLocaleString(), length: info.length.toLocaleString() });
      errorBar.hidden = false;
      window.clearTimeout(tooLongTimer);
      tooLongTimer = window.setTimeout(() => (errorBar.hidden = true), 6000);
    }
    return true;
  };
  const pastedText = (data: DataTransfer | null) => {
    if (!data) return "";
    const plain = data.getData("text/plain");
    return plain || data.getData("text/html").replace(/<[^>]*>/g, "");
  };

  const fileInput = h("input", { attrs: { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", hidden: true, multiple: true } });
  root.append(fileInput);
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (img.onFiles) return img.onFiles(files);
    for (const f of files) {
      const src = img.upload ? await img.upload(f) : await readDataUrl(f);
      api.insertImage(src, "");
    }
  };
  fileInput.addEventListener("change", () => {
    void addFiles([...(fileInput.files ?? [])]);
    fileInput.value = "";
  });

  // ───── 편집기
  let editor: Editor; // 아래에서 만든다 — 그 전에 부르는 곳(확장의 단축키 등)은 만든 뒤에야 불린다
  const run = (cmd: Command) => {
    const ok = cmd(editor.state, editor.view.dispatch);
    editor.view.focus();
    return ok;
  };

  const Shortcuts = Extension.create({
    name: "mdShortcuts",
    addInputRules() {
      const para = (find: RegExp, make: (m: RegExpMatchArray) => Command) =>
        new InputRule({
          find,
          handler: ({ state, range, match, chain }) => {
            const { $from } = state.selection;
            if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;
            chain()
              .deleteRange(range)
              .command(({ state: s, dispatch }) => make(match)(s, dispatch))
              .run();
          },
        });
      const ordered = (m: RegExpMatchArray): Command => (s, dispatch) => {
        let tr: Transaction | null = null;
        if (!setListKind("ordered")(s, (t) => (tr = t)) || !tr) return false;
        const n = Number(m[1]);
        const t: Transaction = tr;
        const { $from } = t.selection;
        if (n !== 1 && $from.parent.type.name === "mdItem") t.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, start: n });
        dispatch?.(t);
        return true;
      };
      const taskInItem = new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== "mdItem") return null;
          const pos = $from.before();
          const attrs = { ...$from.parent.attrs, checked: /x/i.test(match[1] ?? ""), ordered: false };
          chain()
            .deleteRange(range)
            .command(({ tr }) => (tr.setNodeMarkup(pos, undefined, attrs), true))
            .run();
        },
      });
      return [
        para(/^[-*+]\s$/, () => setListKind("bullet")),
        para(/^(\d{1,9})[.)]\s$/, ordered),
        para(/^\[([ xX]?)\]\s$/, (m) => (s, dispatch) => {
          let tr: Transaction | null = null;
          if (!setListKind("task")(s, (t) => (tr = t)) || !tr) return false;
          const t: Transaction = tr;
          const { $from } = t.selection;
          if (/x/i.test(m[1] ?? "") && $from.parent.type.name === "mdItem") t.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, checked: true });
          dispatch?.(t);
          return true;
        }),
        taskInItem,
        para(/^##\s$/, () => setBlockKind("sectionHead")),
        para(/^###\s$/, () => setBlockKind("blockTitle")),
        para(/^>\s$/, () => setBlockKind("mdNote")),
      ];
    },
  });

  const Keys = Extension.create({
    name: "mdKeys",
    addKeyboardShortcuts() {
      return {
        "Mod-k": () => (openLink(), true),
        "Mod-f": () => (openFind(), true),
        "Mod-Shift-7": () => run(setListKind("ordered")),
        "Mod-Shift-8": () => run(setListKind("bullet")),
        "Mod-Shift-9": () => run(setListKind("task")),
        "Mod-Enter": () => run(insertPageBreak),
        "Mod-Alt-0": () => run(setBlockKind("paragraph")),
        "Mod-Alt-2": () => run(setBlockKind("sectionHead")),
        "Mod-Alt-3": () => run(setBlockKind("blockTitle")),
      };
    },
  });

  /** 붙여 넣은 글이 MD 처럼 보이면 문서로 읽어 넣는다(코드 블록 안 · Shift 붙여넣기는 글 그대로). */
  const clipboardTextParser = (text: string, $context: ResolvedPos, plain: boolean, view: EditorView) => {
    if (plain || $context.parent.type.spec.code || !looksLikeMd.test(text)) return null as unknown as Slice;
    try {
      const pm = toPM(parseMarkdown(text, dialect));
      const nodes = (pm.content ?? []).map((n) => (n.type === "docTitle" ? { ...n, type: "sectionHead" } : n));
      const doc = view.state.schema.nodeFromJSON({ type: "doc", content: nodes });
      if (doc.childCount === 1 && doc.firstChild!.type.name === "paragraph") return new Slice(doc.content, 1, 1);
      return Slice.maxOpen(doc.content);
    } catch {
      return null as unknown as Slice;
    }
  };

  editor = new Editor({
    element: mount,
    extensions: [
      ...richExtensions({ resolveImage, messages: msg }),
      Shortcuts,
      Keys,
      FindReplace,
      PageMarksExtension.configure({ label: (n: number) => fill(msg.pageLabel, { n }) }),
      ...(options.placeholder ? [Placeholder.configure({ placeholder: options.placeholder })] : []),
      ...(options.extensions ?? []),
    ],
    content,
    editable: options.editable ?? true,
    editorProps: {
      attributes: { class: contentClass, "aria-label": msg.editorLabel, spellcheck: "false" },
      handlePaste: (view, event) => {
        if (options.maxLength || options.maxPaste) {
          const { from, to } = view.state.selection;
          const add = pastedText(event.clipboardData).length;
          const next = md.length - view.state.doc.textBetween(from, to, "\n").length + add;
          if (add && blocksPaste(add, next, md.length)) return true;
        }
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        void addFiles(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        if (event.defaultPrevented) return true; // 쓰는 쪽이 이미 받았다
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) editor.commands.setTextSelection(at.pos);
        void addFiles(files);
        return true;
      },
      clipboardTextParser,
    },
    onUpdate: () => changed(),
    onTransaction: () => scheduleRefresh(), // 도구 막대는 한 프레임에 한 번 — 칸을 끄는 동안 거래마다 화면을 고치지 않는다
  });

  // ───── MD · 미리보기 · 글자 수
  let md = initialError ? (options.markdown ?? "") : fromPM(editor.getJSON(), dialect);
  let previewTimer = 0;

  const changed = () => {
    md = fromPM(editor.getJSON(), dialect);
    emit("change", md);
    options.onChange?.(md, api);
    schedulePreview();
    updateStatus();
  };

  const renderPreview = () => {
    if (!previewOn) return;
    try {
      const doc = mode === "source" ? parseMarkdown(md, dialect) : pmToDoc(editor.getJSON(), dialect);
      previewDoc.innerHTML = renderHtml(doc, { resolveImage });
    } catch (e) {
      previewDoc.textContent = e instanceof MdError ? errorText(e) : String(e);
    }
  };
  const schedulePreview = () => {
    if (!previewOn) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, 120);
  };

  const updateStatus = () => {
    if (options.statusbar === false) return;
    const text = mode === "source" ? source.value : editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
    const chars = text.replace(/\n/g, "").length;
    const words = (text.match(/\S+/g) ?? []).length;
    const pages = marksVisible && pageMarks && mode === "wysiwyg" ? ` · ${fill(msg.pagesTotal, { n: pageMarks.total })}` : "";
    status.textContent = `${fill(msg.chars, { n: chars.toLocaleString() })} · ${fill(msg.words, { n: words.toLocaleString() })}${pages}`;
  };

  const errorText = (e: MdError) => {
    const message = fill((msg as Record<string, string>)[e.code] ?? e.message, e.params);
    return e.line ? fill(msg.sourceError, { line: e.line, message }) : fill(msg.sourceErrorNoLine, { message });
  };
  const showError = (e: MdError | null) => {
    errorBar.hidden = !e;
    errorBar.textContent = e ? errorText(e) : "";
  };

  // ───── 도구 막대
  type UiState = {
    source: boolean;
    editable: boolean;
    kind: BlockKind | null;
    marks: boolean;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
    sup: boolean;
    sub: boolean;
    highlight: boolean;
    shade: boolean;
    color: string | null;
    link: string | null;
    list: ListKind | null;
    align: ParagraphAlign | null;
    inTable: boolean;
    inCode: boolean;
    canUndo: boolean;
    canRedo: boolean;
  };

  const uiState = (): UiState => {
    const e = editor;
    const s = e.state;
    const parent = s.selection.$from.parent;
    return {
      source: mode === "source",
      editable: e.isEditable,
      kind: blockKind(s),
      marks: parent.type.allowsMarkType(s.schema.marks.bold),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      sup: e.isActive("superscript"),
      sub: e.isActive("subscript"),
      highlight: e.isActive("mdHighlight"),
      shade: e.isActive("mdShade"),
      color: e.isActive("mdColor") ? ((e.getAttributes("mdColor").name as string | undefined) ?? null) : null,
      link: e.isActive("link") ? ((e.getAttributes("link").href as string | undefined) ?? "") : null,
      list: listKind(s),
      align: paragraphAlign(s),
      inTable: e.isActive("table"),
      inCode: parent.type.name === "codeBlock",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    };
  };

  type Item = { update: (st: UiState) => void };
  const items: Item[] = [];
  const editing = (st: UiState) => st.editable && !st.source;
  const formatting = (st: UiState) => editing(st) && st.marks;

  function button(name: string, label: string, inner: string, onClick: () => void, opts: { pressed?: (st: UiState) => boolean; enabled?: (st: UiState) => boolean; word?: boolean; shortcut?: string } = {}) {
    const title = opts.shortcut ? fill(msg.shortcut, { label, key: key(opts.shortcut) }) : label;
    const b = h("button", { className: `mde-btn${opts.word ? " word" : ""}`, html: inner, title, attrs: { type: "button", "data-name": name, "aria-label": label }, on: { click: onClick } });
    items.push({
      update: (st) => {
        b.disabled = !(opts.enabled ?? editing)(st);
        if (opts.pressed) b.setAttribute("aria-pressed", String(opts.pressed(st)));
      },
    });
    return b;
  }

  /** 팝업 단추. 내용은 열 때마다 만든다(지금 상태를 보여 준다). */
  function menuButton(name: string, label: string, inner: (st: UiState) => string, build: (close: () => void) => HTMLElement, opts: { enabled?: (st: UiState) => boolean; pressed?: (st: UiState) => boolean; shortcut?: string } = {}) {
    const title = opts.shortcut ? fill(msg.shortcut, { label, key: key(opts.shortcut) }) : label;
    const b = h("button", { className: "mde-btn", title, attrs: { type: "button", "data-name": name, "aria-label": label } });
    const p = popover(pops, b, build);
    let last = "";
    items.push({
      update: (st) => {
        const html = inner(st);
        if (html !== last) b.innerHTML = last = html;
        b.disabled = !(opts.enabled ?? editing)(st);
        if (opts.pressed) b.setAttribute("aria-pressed", String(opts.pressed(st)));
        if (b.disabled) p.close();
      },
    });
    return p;
  }

  const glyph = (ch: string, tag: string) => `<${tag} class="mde-glyph">${ch}</${tag}>`;
  const markBtn = (name: string, label: string, inner: string, mark: string, active: (st: UiState) => boolean, shortcut?: string) =>
    button(name, label, inner, () => editor.chain().focus().toggleMark(mark).run(), { pressed: active, enabled: formatting, shortcut });

  const KINDS: [BlockKind, keyof Messages][] = [
    ["paragraph", "paragraph"],
    ["sectionHead", "sectionHead"],
    ["blockTitle", "blockTitle"],
    ["list", "list"],
    ["mdNote", "note"],
    ["codeBlock", "codeBlock"],
    ["docTitle", "docTitle"],
  ];

  let linkPop: ReturnType<typeof menuButton> | null = null;
  function openLink() {
    if (linkPop && !linkPop.button.disabled) linkPop.open();
  }

  const removeFormat = () => {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    const tr = state.tr;
    for (const type of Object.values(state.schema.marks)) {
      if (type.name === "link") continue;
      if (!empty) tr.removeMark(from, to, type);
    }
    tr.setStoredMarks([]);
    editor.view.dispatch(tr);
    editor.view.focus();
  };

  const factories: Record<string, () => HTMLElement> = {
    undo: () => button("undo", msg.undo, icon("undo"), () => editor.chain().focus().undo().run(), { enabled: (st) => editing(st) && st.canUndo, shortcut: "Z" }),
    redo: () => button("redo", msg.redo, icon("redo"), () => editor.chain().focus().redo().run(), { enabled: (st) => editing(st) && st.canRedo, shortcut: "Shift+Z" }),
    blockKind: () => {
      const select = h("select", { className: "mde-select", attrs: { "aria-label": msg.blockKind, "data-name": "blockKind" } });
      const none = h("option", { text: msg.tableOrImage, attrs: { value: "" } });
      select.append(none, ...KINDS.map(([k, label]) => h("option", { text: msg[label], attrs: { value: k } })));
      select.addEventListener("change", () => {
        const kind = select.value as BlockKind;
        if (kind && blockKind(editor.state) !== kind) setBlockKind(kind)(editor.state, editor.view.dispatch);
        editor.view.focus();
      });
      items.push({
        update: (st) => {
          none.hidden = !!st.kind;
          select.value = st.kind ?? "";
          select.disabled = !editing(st) || !st.kind;
        },
      });
      return select;
    },
    bold: () => markBtn("bold", msg.bold, glyph("B", "b"), "bold", (st) => st.bold, "B"),
    italic: () => markBtn("italic", msg.italic, glyph("I", "i"), "italic", (st) => st.italic, "I"),
    underline: () => markBtn("underline", msg.underline, glyph("U", "u"), "underline", (st) => st.underline, "U"),
    strike: () => markBtn("strike", msg.strike, glyph("S", "s"), "strike", (st) => st.strike, "Shift+S"),
    code: () => markBtn("code", msg.code, icon("code"), "code", (st) => st.code, "E"),
    superscript: () => markBtn("superscript", msg.superscript, `<span class="mde-glyph">x<sup>2</sup></span>`, "superscript", (st) => st.sup, "."),
    subscript: () => markBtn("subscript", msg.subscript, `<span class="mde-glyph">x<sub>2</sub></span>`, "subscript", (st) => st.sub, ","),
    highlight: () => markBtn("highlight", msg.highlight, icon("highlight"), "mdHighlight", (st) => st.highlight, "Shift+H"),
    removeFormat: () => button("removeFormat", msg.removeFormat, icon("removeFormat"), removeFormat, { enabled: formatting }),
    color: () =>
      menuButton(
        "color",
        msg.textColor,
        (st) => colorGlyph(localeDialect === "en" ? "A" : "가", st.color, st.shade),
        (close) => {
          const st = uiState();
          return colorPanel(
            msg,
            st.color,
            st.shade,
            true,
            (name) => (close(), name ? editor.chain().focus().setMark("mdColor", { name }).run() : editor.chain().focus().unsetMark("mdColor").run()),
            () => (close(), editor.chain().focus().toggleMark("mdShade").run()),
          );
        },
        { enabled: formatting },
      ).wrap,
    link: () => {
      linkPop = menuButton(
        "link",
        msg.link,
        () => icon("link"),
        (close) => {
          const st = uiState();
          const empty = editor.state.selection.empty && st.link === null;
          return linkPanel(
            msg,
            st.link,
            empty,
            (href, text) => {
              close();
              if (empty) {
                const label = text || href;
                editor.chain().focus().insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
              } else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            },
            st.link !== null ? () => (close(), editor.chain().focus().extendMarkRange("link").unsetLink().run()) : null,
          );
        },
        { enabled: formatting, pressed: (st) => st.link !== null, shortcut: "K" },
      );
      return linkPop.wrap;
    },
    bulletList: () => button("bulletList", msg.bulletList, icon("bulletList"), () => run(setListKind("bullet")), { pressed: (st) => st.list === "bullet", shortcut: "Shift+8" }),
    orderedList: () => button("orderedList", msg.orderedList, icon("orderedList"), () => run(setListKind("ordered")), { pressed: (st) => st.list === "ordered", shortcut: "Shift+7" }),
    taskList: () => button("taskList", msg.taskList, icon("taskList"), () => run(setListKind("task")), { pressed: (st) => st.list === "task", shortcut: "Shift+9" }),
    outdent: () => button("outdent", msg.outdent, icon("outdent"), () => run(shiftItem(-1)), { enabled: (st) => editing(st) && st.list !== null }),
    indent: () => button("indent", msg.indent, icon("indent"), () => run(shiftItem(1)), { enabled: (st) => editing(st) && st.list !== null }),
    align: () =>
      menuButton(
        "align",
        msg.align,
        (st) => icon(ALIGNS.find(([a]) => a === (st.align ?? "left"))?.[1] ?? "alignLeft") + '<span class="mde-caret" aria-hidden="true">▾</span>',
        (close) => alignPanel(msg, paragraphAlign(editor.state), (a) => (close(), run(setParagraphAlign(a)))),
        { enabled: (st) => editing(st) && st.align !== null },
      ).wrap,
    table: () =>
      menuButton("table", msg.insertTable, () => icon("table"), (close) => tableGrid(msg, (rows, cols) => (close(), editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run())), {
        enabled: (st) => editing(st) && !st.inTable && !st.inCode,
      }).wrap,
    image: () => {
      if (img.pick) return button("image", msg.insertImage, icon("image"), () => img.pick!(), { enabled: (st) => editing(st) && !st.inTable });
      return menuButton(
        "image",
        msg.insertImage,
        () => icon("image"),
        (close) =>
          imagePanel(
            msg,
            (src, caption) => (close(), api.insertImage(src, caption)),
            () => (close(), fileInput.click()),
          ),
        { enabled: (st) => editing(st) && !st.inTable },
      ).wrap;
    },
    codeBlock: () => button("codeBlock", msg.codeBlock, icon("codeBlock"), () => run(setBlockKind("codeBlock")), { pressed: (st) => st.kind === "codeBlock", enabled: (st) => editing(st) && !!st.kind, shortcut: "Alt+C" }),
    horizontalRule: () => button("horizontalRule", msg.horizontalRule, icon("horizontalRule"), () => editor.chain().focus().setHorizontalRule().run(), { enabled: (st) => editing(st) && !st.inTable }),
    pageBreak: () => button("pageBreak", msg.pageBreak, icon("pageBreak"), () => run(insertPageBreak), { enabled: (st) => editing(st) && !st.inTable, shortcut: "Enter" }),
    specialChars: () =>
      menuButton("specialChars", msg.specialChars, () => '<span class="mde-glyph">Ω</span>', (close) => specialCharsPanel(msg, (ch) => (close(), editor.chain().focus().insertContent(ch).run())), {
        enabled: (st) => editing(st),
      }).wrap,
    find: () => button("find", msg.findReplace, icon("find"), () => (findbar.hidden ? openFind() : closeFind()), { pressed: () => !findbar.hidden, shortcut: "F" }),
    source: () => button("source", msg.source, '<span class="mde-glyph mde-md">MD</span>', () => api.setMode(mode === "source" ? "wysiwyg" : "source"), { pressed: (st) => st.source, enabled: () => true }),
    preview: () => button("preview", msg.preview, icon("preview"), () => api.setPreview(!previewOn), { pressed: () => previewOn, enabled: () => true }),
    pageMarks: () => button("pageMarks", msg.pageMarks, icon("pages"), () => api.setPageMarksVisible(!marksVisible), { pressed: () => marksVisible, enabled: (st) => !st.source }),
    fullscreen: () => {
      const b = button("fullscreen", msg.fullscreen, icon("fullscreen"), () => api.setFullscreen(!fullscreen), { pressed: () => fullscreen, enabled: () => true });
      items.push({
        update: () => {
          const label = fullscreen ? msg.fullscreenExit : msg.fullscreen;
          if (b.getAttribute("aria-label") !== label) {
            b.innerHTML = icon(fullscreen ? "fullscreenExit" : "fullscreen");
            b.title = label;
            b.setAttribute("aria-label", label);
          }
        },
      });
      return b;
    },
  };

  // ───── 찾아 바꾸기
  const findInput = h("input", { className: "mde-input", attrs: { type: "search", placeholder: msg.findPlaceholder, "aria-label": msg.find, spellcheck: "false" } });
  const replaceInput = h("input", { className: "mde-input", attrs: { type: "text", placeholder: msg.replacePlaceholder, "aria-label": msg.replacePlaceholder, spellcheck: "false" } });
  const findCount = h("span", { className: "mde-find-count" });
  const caseBox = h("input", { attrs: { type: "checkbox" } });
  const fbtn = (label: string, inner: string, onClick: () => void, word = false) => h("button", { className: `mde-btn${word ? " word" : ""}`, html: inner, title: label, attrs: { type: "button", "aria-label": label }, on: { click: onClick } });
  const findStep = (dir: 1 | -1) => {
    const tr = stepFind(editor.state, dir);
    if (tr) editor.view.dispatch(tr);
  };
  findbar.append(
    findInput,
    findCount,
    fbtn(msg.findPrev, icon("chevronUp"), () => findStep(-1)),
    fbtn(msg.findNext, icon("chevronDown"), () => findStep(1)),
    h("label", { className: "mde-check-label" }, caseBox, msg.matchCase),
    h("span", { className: "mde-sep" }),
    replaceInput,
    fbtn(msg.replace, msg.replace, () => {
      const tr = replaceOne(editor.state, replaceInput.value);
      if (tr) editor.view.dispatch(tr);
    }, true),
    fbtn(msg.replaceAll, msg.replaceAll, () => {
      const tr = replaceAll(editor.state, replaceInput.value);
      if (tr) editor.view.dispatch(tr);
    }, true),
    h("span", { className: "mde-spacer" }),
    fbtn(msg.close, icon("close"), () => closeFind()),
  );
  const syncFind = () => editor.view.dispatch(setFind(editor.state, { query: findInput.value, caseSensitive: caseBox.checked }));
  findInput.addEventListener("input", syncFind);
  caseBox.addEventListener("change", syncFind);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") closeFind();
  });
  replaceInput.addEventListener("keydown", (e) => e.key === "Escape" && closeFind());
  function openFind() {
    if (mode === "source") return;
    findbar.hidden = false;
    const { from, to, empty } = editor.state.selection;
    if (!empty && to - from < 200) {
      findInput.value = editor.state.doc.textBetween(from, to, " ");
      syncFind();
    }
    findInput.focus();
    findInput.select();
    refresh();
  }
  function closeFind() {
    findbar.hidden = true;
    editor.view.dispatch(setFind(editor.state, { query: "" }));
    editor.view.focus();
  }
  const updateFindCount = () => {
    const s = findKey.getState(editor.state);
    if (!s?.query) findCount.textContent = "";
    else findCount.textContent = s.matches.length ? fill(msg.findCount, { i: s.index + 1, n: s.matches.length }) : msg.findNone;
  };

  // ───── 표 · 코드 도구(커서가 그 안에 있을 때만)
  const tbtn = (label: string, onClick: () => void, title?: string) => h("button", { className: "mde-btn word", text: label, title: title ?? label, attrs: { type: "button" }, on: { click: onClick } });
  const tableBar = h(
    "div",
    { className: "mde-bar mde-table-bar", attrs: { role: "toolbar", "aria-label": msg.tableToolbar } },
    h("span", { className: "mde-bar-label", text: msg.table }),
    tbtn(msg.rowAbove, () => run(addRowAbove)),
    tbtn(msg.rowBelow, () => run(addRowBelow)),
    tbtn(msg.colLeft, () => editor.chain().focus().addColumnBefore().run()),
    tbtn(msg.colRight, () => editor.chain().focus().addColumnAfter().run()),
    tbtn(msg.deleteRow, () => editor.chain().focus().deleteRow().run()),
    tbtn(msg.deleteCol, () => editor.chain().focus().deleteColumn().run()),
    h("span", { className: "mde-sep" }),
    tbtn(msg.mergeCells, () => run(mergeSafe), msg.mergeHint),
    tbtn(msg.splitCell, () => editor.chain().focus().splitCell().run()),
    tbtn(msg.cellShade, () => run(toggleCellShade)),
    h("span", { className: "mde-sep" }),
    tbtn(msg.colLeftAlign, () => run(setColumnAlign("left")), fill(msg.colAlignTitle, { side: msg.colLeftAlign })),
    tbtn(msg.colCenterAlign, () => run(setColumnAlign("center")), fill(msg.colAlignTitle, { side: msg.colCenterAlign })),
    tbtn(msg.colRightAlign, () => run(setColumnAlign("right")), fill(msg.colAlignTitle, { side: msg.colRightAlign })),
    h("span", { className: "mde-sep" }),
    tbtn(msg.deleteTable, () => editor.chain().focus().deleteTable().run()),
  );
  const langInput = h("input", { className: "mde-input mde-lang", attrs: { type: "text", list: "mde-langs", placeholder: msg.codeLanguageNone, "aria-label": msg.codeLanguage, spellcheck: "false" } });
  const langs = h("datalist", { attrs: { id: "mde-langs" } }, ...["js", "ts", "jsx", "tsx", "json", "html", "css", "py", "java", "kotlin", "swift", "go", "rust", "c", "cpp", "cs", "php", "ruby", "sql", "bash", "sh", "yaml", "toml", "xml", "md", "diff", "text"].map((l) => h("option", { attrs: { value: l } })));
  langInput.addEventListener("change", () => {
    const value = langInput.value.trim().split(/\s+/)[0]?.replace(/`/g, "") || null;
    editor.chain().updateAttributes("codeBlock", { language: value }).run();
  });
  langInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      langInput.dispatchEvent(new Event("change"));
      editor.view.focus();
    }
  });
  const codeBar = h("div", { className: "mde-bar mde-code-bar", attrs: { role: "toolbar", "aria-label": msg.codeBlock } }, h("span", { className: "mde-bar-label", text: msg.codeBlock }), h("label", { className: "mde-check-label" }, msg.codeLanguage, langInput, langs));

  // 도구 막대 단추를 눌러도 초점이 편집기에 남게 한다(고른 칸이 풀리지 않도록). 팝업 안의 입력 칸은 그대로 둔다.
  const keepFocus = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button") && !t.closest(".mde-pop")) e.preventDefault();
  };
  toolbar.addEventListener("mousedown", keepFocus);
  context.addEventListener("mousedown", keepFocus);

  // ───── 상태 반영
  let barHeight = 0;
  let lastBar: HTMLElement | null = null;
  let refreshFrame = 0;
  function scheduleRefresh() {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      refresh();
    });
  }
  function refresh() {
    if (refreshFrame) {
      cancelAnimationFrame(refreshFrame);
      refreshFrame = 0;
    }
    if (!editor || editor.isDestroyed) return;
    const st = uiState();
    for (const it of items) it.update(st);
    // 표 · 코드 도구 — 나타나거나 사라지면 그 높이만큼 스크롤을 옮겨 문서가 제자리에 있게 한다
    const bar = st.source ? null : st.inTable ? tableBar : st.inCode ? codeBar : null;
    if (bar !== lastBar) {
      context.replaceChildren(...(bar ? [bar] : []));
      lastBar = bar;
      const hgt = context.offsetHeight;
      const delta = hgt - barHeight;
      barHeight = hgt;
      if (delta) scroll.scrollTop += delta;
    }
    if (st.inCode && document.activeElement !== langInput) langInput.value = String(editor.state.selection.$from.parent.attrs.language ?? "");
    updateFindCount();
  }

  // ───── 원문 모드
  source.addEventListener("input", () => {
    md = source.value;
    emit("change", md);
    options.onChange?.(md, api);
    schedulePreview();
    updateStatus();
  });
  source.addEventListener("paste", (e) => {
    if (!options.maxLength && !options.maxPaste) return;
    const add = pastedText(e.clipboardData).length;
    const next = source.value.length - (source.selectionEnd - source.selectionStart) + add;
    if (add && blocksPaste(add, next, source.value.length)) e.preventDefault();
  });
  source.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  });

  const applyMode = (next: EditorMode) => {
    mode = next;
    root.dataset.mode = next;
    scroll.hidden = next === "source";
    source.hidden = next !== "source";
    if (next === "source") findbar.hidden = true;
    refresh();
    updateStatus();
    renderPreview();
    emit("mode", next);
  };

  // ───── 밖으로 내놓는 손잡이
  const api: MarkdownEditor = {
    get tiptap() {
      return editor;
    },
    element: root,
    messages: msg,
    getMarkdown: () => md,
    setMarkdown(markdown: string) {
      if (!dialectFixed) dialect = dialectOf(markdown) ?? dialect;
      const doc = parseMarkdown(markdown, dialect);
      showError(null);
      editor.commands.setContent(toPM(doc), { emitUpdate: false });
      md = fromPM(editor.getJSON(), dialect);
      if (mode === "source") source.value = markdown;
      schedulePreview();
      updateStatus();
    },
    getDoc: () => (mode === "source" ? parseMarkdown(md, dialect) : pmToDoc(editor.getJSON(), dialect)),
    setDoc(doc: Doc) {
      if (!dialectFixed && doc.dialect) dialect = doc.dialect;
      editor.commands.setContent(toPM(doc), { emitUpdate: false });
      md = fromPM(editor.getJSON(), dialect);
      if (mode === "source") source.value = md;
      schedulePreview();
      updateStatus();
    },
    getHTML: () => renderHtml(api.getDoc(), { resolveImage }),
    insertImage(src: string, caption = "") {
      if (mode === "source") {
        const at = source.selectionEnd;
        const line = `![${caption}](${src})`;
        source.setRangeText(`\n\n${line}\n`, at, at, "end");
        source.dispatchEvent(new Event("input"));
        return;
      }
      editor.chain().focus().insertContent({ type: "mdImage", attrs: { src, caption } }).run();
    },
    replaceImage(from: string, to: string | null) {
      if (mode === "source") {
        const next = to ? source.value.split(from).join(to) : source.value.split("\n").filter((l) => !l.includes(`](${from})`)).join("\n");
        if (next !== source.value) {
          source.value = next;
          source.dispatchEvent(new Event("input"));
        }
        return;
      }
      const found: { pos: number; size: number; attrs: Record<string, unknown> }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "mdImage" && node.attrs.src === from) found.push({ pos, size: node.nodeSize, attrs: node.attrs });
      });
      if (!found.length) return;
      const tr = editor.state.tr;
      for (const f of found.reverse()) {
        if (to) tr.setNodeMarkup(f.pos, undefined, { ...f.attrs, src: to });
        else tr.delete(f.pos, f.pos + f.size);
      }
      editor.view.dispatch(tr.setMeta("addToHistory", false)); // 되돌리기로 옛 주소가 돌아오지 않게
    },
    refreshImages() {
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "mdImage") tr.setNodeMarkup(pos, undefined, { ...node.attrs });
      });
      if (tr.steps.length) editor.view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventUpdate", true));
      schedulePreview();
    },
    getMode: () => mode,
    setMode(next: EditorMode) {
      if (next === mode) return true;
      pops.current?.close();
      if (next === "source") {
        source.value = md;
        applyMode("source");
        source.focus();
        return true;
      }
      try {
        if (!dialectFixed) dialect = dialectOf(source.value) ?? dialect;
        const doc = parseMarkdown(source.value, dialect);
        editor.commands.setContent(toPM(doc), { emitUpdate: false });
      } catch (e) {
        if (e instanceof MdError) {
          showError(e);
          return false;
        }
        throw e;
      }
      showError(null);
      const before = md;
      md = fromPM(editor.getJSON(), dialect);
      applyMode("wysiwyg");
      if (md !== before) {
        emit("change", md);
        options.onChange?.(md, api);
      }
      editor.commands.focus();
      return true;
    },
    isPreview: () => previewOn,
    setPreview(on: boolean) {
      previewOn = on;
      root.dataset.preview = on ? "on" : "off";
      if (on) renderPreview();
      refresh();
      emit("preview", on);
    },
    setPageMarks(marks: PageMarks | null) {
      pageMarks = marks;
      editor.view.dispatch(setPageMarksMeta(editor.state, { marks }));
      updateStatus();
    },
    isPageMarksVisible: () => marksVisible,
    setPageMarksVisible(on: boolean) {
      if (on === marksVisible) return;
      marksVisible = on;
      root.dataset.pagemarks = on ? "on" : "off";
      editor.view.dispatch(setPageMarksMeta(editor.state, { visible: on }));
      refresh();
      updateStatus();
      emit("pagemarks", on);
    },
    isFullscreen: () => fullscreen,
    setFullscreen(on: boolean) {
      fullscreen = on;
      root.classList.toggle("mde-fullscreen", on);
      document.documentElement.classList.toggle("mde-noscroll", on);
      refresh();
      emit("fullscreen", on);
    },
    setEditable(on: boolean) {
      editor.setEditable(on);
      source.readOnly = !on;
      refresh();
    },
    setDialect(d: Dialect) {
      if (d === dialect) return;
      dialect = d;
      if (mode === "wysiwyg") md = fromPM(editor.getJSON(), dialect);
    },
    slot: (name) => slots[name],
    focus: () => (mode === "source" ? source.focus() : editor.commands.focus()),
    on(event, fn) {
      (listeners[event] as Set<typeof fn>).add(fn);
      return () => (listeners[event] as Set<typeof fn>).delete(fn);
    },
    destroy() {
      window.clearTimeout(previewTimer);
      window.clearTimeout(tooLongTimer);
      if (refreshFrame) cancelAnimationFrame(refreshFrame);
      pops.current?.close();
      document.removeEventListener("keydown", escFullscreen);
      document.documentElement.classList.remove("mde-noscroll");
      editor.destroy();
      root.remove();
    },
  };

  // 도구 막대 짜기
  toolbar.append(slots.start);
  const config = options.toolbar === false ? [] : (options.toolbar ?? DEFAULT_TOOLBAR);
  let group = h("span", { className: "mde-group" });
  const flushGroup = () => {
    if (group.childNodes.length) toolbar.append(group);
    group = h("span", { className: "mde-group" });
  };
  for (const it of config) {
    if (it === "|") {
      flushGroup();
      toolbar.append(h("span", { className: "mde-sep", attrs: { role: "separator" } }));
      continue;
    }
    const el = typeof it === "string" ? factories[it]?.() : it.render(api);
    if (el) group.append(el);
  }
  flushGroup();
  toolbar.append(slots.end);


  const escFullscreen = (e: KeyboardEvent) => {
    if (e.key === "Escape" && fullscreen && !pops.current) api.setFullscreen(false);
  };
  document.addEventListener("keydown", escFullscreen);

  root.dataset.preview = previewOn ? "on" : "off";
  root.dataset.pagemarks = marksVisible ? "on" : "off";
  if (marksVisible) editor.view.dispatch(setPageMarksMeta(editor.state, { visible: true }));
  if (initialError) {
    source.value = options.markdown ?? "";
    applyMode("source");
    showError(initialError);
  } else if (options.mode === "source") {
    source.value = md;
    applyMode("source");
  } else {
    refresh();
    updateStatus();
    renderPreview();
  }
  return api;
}

