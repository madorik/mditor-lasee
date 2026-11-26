// 문서 편집기 스키마 — MD 와 1:1 로 맞춘다.
// 스키마에 없는 것은 붙여넣기 때 자동으로 버려진다(워드의 글자 크기·다른 글꼴 등).
//
//   docTitle (h1, 한 줄)             # 문서 제목 — 맨 앞에만
//   sectionHead (h2, 한 줄)          ## 섹션
//   blockTitle (h3, 한 줄)           ### 블록 제목      (제목에도 글 서식을 쓴다. 줄바꿈은 없다)
//   paragraph{align}                 문단 ({가운데}…{/가운데} 로 정렬)
//   mdList > mdItem{level, ordered, start, checked}   - 항목 / 1. 번호 / - [ ] 할 일 (Tab / Shift-Tab)
//   table > 칸(paragraph+, shade, align)   MD 표 + < / ^ + 칸 음영
//   mdNote (blockquote)              > 비고 (줄마다 하나)
//   mdImage{src, caption, width} (atom) ![설명](이름){width=N%} — 본문에도, 표 칸 안에도
//   codeBlock{language}              ```언어
//   horizontalRule                   ---
//   pageBreak                        <!-- pagebreak -->
//   marks: link · bold · strike · italic · underline · mdShade · mdHighlight · mdColor{name} · superscript · subscript · code
//   hardBreak                        <br>

import { Mark, Node, mergeAttributes, markInputRule, markPasteRule, type AnyExtension } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import Paragraph from "@tiptap/extension-paragraph";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { colorCss, isColor, MARK, SHADE, safeHref } from "../core/inline";
import { fill, ko, type Messages } from "../ui/messages";
import { backspaceItem, shiftItem, splitItem } from "./commands";
import { CellSelectionGuard, ListNumbers } from "./plugins";
import { imageWidth } from "./convert";

// 문단을 맨 앞에 둔다 — Enter 로 새로 생기는 블록의 기본이 문단이 되도록.
const TOP = "docTitle? (paragraph | sectionHead | blockTitle | mdList | table | mdNote | mdImage | codeBlock | horizontalRule | pageBreak)+";
export const MAX_LEVEL = 3;

const MdDoc = Node.create({ name: "doc", topNode: true, content: TOP });

function heading(name: string, tag: string) {
  return Node.create({
    name,
    content: "text*",
    defining: true,
    parseHTML() {
      return [{ tag }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { class: `md-${tag}` }), 0];
    },
  });
}

const DocTitle = heading("docTitle", "h1");
const SectionHead = heading("sectionHead", "h2");
const BlockTitle = Node.create({
  name: "blockTitle",
  content: "text*",
  defining: true,
  parseHTML() {
    return [{ tag: "h3" }, { tag: "h4" }, { tag: "h5" }, { tag: "h6" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["h3", mergeAttributes(HTMLAttributes, { class: "md-h3" }), 0];
  },
});

const TEXT_ALIGNS = ["center", "right", "justify"];

/** 문단 — 정렬(가운데 · 오른쪽 · 양쪽)을 둔다. 표 칸 안의 문단 정렬은 쓰지 않는다(열 정렬을 쓴다). */
const MdParagraph = Paragraph.extend({
  addAttributes() {
    return {
      align: {
        default: null,
        parseHTML: (el) => {
          const a = (el as HTMLElement).style.textAlign || el.getAttribute("align");
          return a && TEXT_ALIGNS.includes(a) ? a : null;
        },
        renderHTML: (attrs) => (attrs.align ? { style: `text-align:${attrs.align}`, "data-align": attrs.align } : {}),
      },
    };
  },
});

const MdList = Node.create({
  name: "mdList",
  group: "block",
  content: "mdItem+",
  parseHTML() {
    return [{ tag: "ul" }, { tag: "ol" }];
  },
  renderHTML() {
    return ["ul", { class: "md-list" }, 0];
  },
});

function domLevel(el: HTMLElement): number {
  const own = el.getAttribute("data-level");
  if (own !== null) return Math.min(MAX_LEVEL, Math.max(0, Number(own) || 0));
  let depth = -1;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === "UL" || p.tagName === "OL") depth++;
  return Math.min(MAX_LEVEL, Math.max(0, depth));
}

/** 붙여 넣은 항목의 할 일 칸 — 체크박스가 든 항목(구글 문서 · 노션 등)이나 data-checked. */
function domChecked(el: HTMLElement): boolean | null {
  const own = el.getAttribute("data-checked");
  if (own !== null) return own === "true";
  const box = el.querySelector(":scope > input[type=checkbox], :scope > label > input[type=checkbox], :scope > p > input[type=checkbox]") as HTMLInputElement | null;
  return box ? box.checked || box.hasAttribute("checked") : null;
}

export type MdItemOptions = { messages: Messages };

const MdItem = Node.create<MdItemOptions>({
  name: "mdItem",
  content: "inline*",
  defining: true,
  addOptions() {
    return { messages: ko };
  },
  addAttributes() {
    return {
      level: {
        default: 0,
        parseHTML: (el) => domLevel(el as HTMLElement),
        renderHTML: (attrs) => ({ "data-level": attrs.level }),
      },
      ordered: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-ordered") === "true" || (el as HTMLElement).parentElement?.tagName === "OL",
        renderHTML: (attrs) => (attrs.ordered ? { "data-ordered": "true" } : {}),
      },
      start: {
        default: null,
        parseHTML: (el) => {
          const own = (el as HTMLElement).getAttribute("data-start");
          if (own) return Number(own) || null;
          const ol = (el as HTMLElement).parentElement;
          return ol?.tagName === "OL" && ol.firstElementChild === el && ol.hasAttribute("start") ? Number(ol.getAttribute("start")) || null : null;
        },
        renderHTML: (attrs) => (attrs.start != null ? { "data-start": attrs.start } : {}),
      },
      checked: {
        default: null,
        parseHTML: (el) => domChecked(el as HTMLElement),
        renderHTML: (attrs) => (attrs.checked == null ? {} : { "data-checked": attrs.checked ? "true" : "false" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "li" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", HTMLAttributes, 0];
  },
  addNodeView() {
    // 할 일 칸을 누를 수 있게 — 글은 안쪽 칸(contentDOM)에 둔다
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("li");
      const box = document.createElement("span");
      box.className = "md-check";
      box.contentEditable = "false";
      box.setAttribute("role", "checkbox");
      const body = document.createElement("div");
      body.className = "md-item-body";
      dom.append(box, body);
      const paint = () => {
        const a = current.attrs;
        dom.setAttribute("data-level", String(a.level));
        if (a.ordered) dom.setAttribute("data-ordered", "true");
        else dom.removeAttribute("data-ordered");
        if (a.checked == null) {
          dom.removeAttribute("data-checked");
          box.hidden = true;
        } else {
          dom.setAttribute("data-checked", a.checked ? "true" : "false");
          box.hidden = false;
          box.setAttribute("aria-checked", a.checked ? "true" : "false");
        }
      };
      box.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined || !editor.isEditable) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: !current.attrs.checked }));
      });
      paint();
      return {
        dom,
        contentDOM: body,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: (m) => m.type === "attributes" || (m.target instanceof globalThis.Node && box.contains(m.target)),
      };
    };
  },
  addKeyboardShortcuts() {
    const run = (cmd: ReturnType<typeof shiftItem>) => () => cmd(this.editor.state, this.editor.view.dispatch);
    return {
      Enter: run(splitItem),
      Tab: run(shiftItem(1)),
      "Shift-Tab": run(shiftItem(-1)),
      Backspace: run(backspaceItem),
    };
  },
});

const MdNote = Node.create({
  name: "mdNote",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [
      { tag: "blockquote > p", priority: 60 },
      { tag: "blockquote", getAttrs: (el) => ((el as HTMLElement).querySelector("p") ? false : null) },
      { tag: "blockquote", skip: true },
    ];
  },
  renderHTML() {
    return ["blockquote", { class: "md-note" }, 0];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== "mdNote" || $from.parent.content.size) return false;
        return this.editor.commands.setNode("paragraph"); // 빈 비고에서 Enter → 문단으로
      },
    };
  },
});

export type ImageResolver = (src: string) => string | undefined;

const SIZES = [25, 50, 75, 100] as const;

/**
 * 그림 — 본문에도, 표 칸 안에도 놓인다(같은 노드라 끌어서 본문 ↔ 칸을 옮긴다).
 * width: 들어 있는 자리(본문 · 칸) 폭에 대한 % — MD 로는 `![설명](주소){width=N%}`.
 * 화면: 오른쪽 아래 손잡이를 끌어 크기를 바꾸고(두 번 누르면 원래 크기), 고른 그림은 25 · 50 · 75 · 100% · 원래 크기 단추로도 바꾼다.
 */
const MdImage = Node.create<{ resolve: ImageResolver; messages: Messages }>({
  name: "mdImage",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { resolve: () => undefined, messages: ko };
  },
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-src") ?? (el as HTMLElement).querySelector("img")?.getAttribute("src") ?? "" },
      caption: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-caption") ?? (el as HTMLElement).querySelector("figcaption")?.textContent ?? (el as HTMLElement).querySelector("img")?.getAttribute("alt") ?? "",
      },
      width: {
        default: null,
        parseHTML: (el) => imageWidth((el as HTMLElement).getAttribute("data-width") ?? /^\s*(\d+)%\s*$/.exec((el as HTMLElement).querySelector("img")?.style.width ?? "")?.[1] ?? null),
      },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-src]" }, { tag: "figure", getAttrs: (el) => ((el as HTMLElement).querySelector("img") ? null : false) }];
  },
  renderHTML({ node }) {
    return ["figure", { class: "md-image", "data-src": node.attrs.src, "data-caption": node.attrs.caption, ...(node.attrs.width ? { "data-width": String(node.attrs.width) } : {}) }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const msg = this.options.messages;
      let current = node;
      const dom = document.createElement("figure");
      dom.className = "md-image";
      const frame = document.createElement("div"); // 그림이 들어 있는 자리(본문 · 칸) — 폭(%)의 기준
      frame.className = "md-image-frame";
      const box = document.createElement("div"); // 그림 상자 — 폭(%)을 받고, 손잡이가 오른쪽 아래 모서리에 붙는다
      box.className = "md-image-box";
      const img = document.createElement("img");
      img.draggable = false; // 끌기는 그림 노드(figure)가 맡는다 — 브라우저의 그림 끌기를 막는다
      const missing = document.createElement("div");
      missing.className = "md-image-missing";
      const grip = document.createElement("span");
      grip.className = "md-image-grip";
      grip.title = msg.imageMove;
      grip.setAttribute("aria-hidden", "true");
      grip.textContent = "⋮⋮";
      const handle = document.createElement("span");
      handle.className = "md-image-resize";
      handle.title = msg.imageResize;
      handle.setAttribute("aria-hidden", "true");
      const badge = document.createElement("span");
      badge.className = "md-image-badge";
      badge.hidden = true;
      box.append(img, missing, grip, handle, badge);
      frame.append(box);
      const sizes = document.createElement("div"); // 고른 그림의 크기 단추
      sizes.className = "md-image-sizes";
      sizes.setAttribute("role", "group");
      sizes.setAttribute("aria-label", msg.imageWidth);
      sizes.contentEditable = "false";
      const sizeButtons: [HTMLButtonElement, number | null][] = [...SIZES, null].map((w) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "md-image-size";
        btn.textContent = w === null ? msg.imageOriginal : `${w}%`;
        btn.addEventListener("mousedown", (e) => e.preventDefault()); // 고른 상태를 잃지 않게
        btn.addEventListener("click", () => setWidth(w));
        sizes.append(btn);
        return [btn, w];
      });
      const caption = document.createElement("input");
      caption.className = "md-image-caption";
      caption.placeholder = msg.imageCaption;
      caption.setAttribute("aria-label", msg.imageCaption);
      dom.append(frame, sizes, caption);
      img.addEventListener("error", () => {
        img.hidden = true; // 올린 그림을 불러오지 못했다
        missing.hidden = false;
      });

      const pos = () => (typeof getPos === "function" ? getPos() : undefined);
      const setWidth = (w: number | null) => {
        const at = pos();
        if (at === undefined || w === (current.attrs.width ?? null)) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, width: w }));
      };
      const showWidth = (w: number | null) => {
        box.style.width = w ? `${w}%` : "";
        img.style.width = w ? "100%" : "";
        img.style.maxHeight = w ? "none" : ""; // 폭을 정하면 높이 상한을 풀어 정한 폭대로 그린다
      };
      const paint = () => {
        const url = this.options.resolve(current.attrs.src);
        img.hidden = !url;
        missing.hidden = !!url;
        if (url && img.getAttribute("src") !== url) img.src = url;
        img.alt = current.attrs.caption;
        missing.textContent = fill(msg.imageMissing, { src: current.attrs.src });
        if (document.activeElement !== caption) caption.value = current.attrs.caption;
        caption.readOnly = !editor.isEditable;
        showWidth(current.attrs.width ?? null);
        dom.toggleAttribute("data-width", !!current.attrs.width);
        for (const [btn, w] of sizeButtons) btn.setAttribute("aria-pressed", String((current.attrs.width ?? null) === w));
        dom.draggable = editor.isEditable;
        dom.classList.toggle("is-editable", editor.isEditable);
      };
      const commit = () => {
        const at = pos();
        if (at === undefined || caption.value === current.attrs.caption) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, caption: caption.value }));
      };
      caption.addEventListener("input", commit);
      caption.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          caption.blur();
        }
      });

      // 크기 조절 — 손잡이를 끄는 동안은 화면에서만 바꾸고, 놓을 때 한 번 문서에 적는다(되돌리기 한 번에 돌아간다)
      handle.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const room = Math.max(1, frame.getBoundingClientRect().width); // 그림이 들어 있는 자리(본문 · 칸)의 폭 — 그림 폭의 % 기준
        const startX = e.clientX;
        const startW = box.getBoundingClientRect().width;
        let next: number | null = current.attrs.width ?? null;
        handle.setPointerCapture(e.pointerId);
        dom.classList.add("is-resizing");
        badge.hidden = false;
        const move = (ev: PointerEvent) => {
          const px = Math.min(room, Math.max(room * 0.05, startW + (ev.clientX - startX)));
          next = Math.max(5, Math.min(100, Math.round((px / room) * 100)));
          showWidth(next);
          badge.textContent = `${next}%`;
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          dom.classList.remove("is-resizing");
          badge.hidden = true;
          if (next !== (current.attrs.width ?? null)) setWidth(next);
          else showWidth(current.attrs.width ?? null);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });
      handle.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (editor.isEditable) setWidth(null);
      });

      paint();
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        selectNode() {
          dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          dom.classList.remove("ProseMirror-selectednode");
        },
        // 설명 칸 · 크기 단추 · 크기 손잡이는 편집기가 다루지 않는다(끌어서 옮기기는 그림 노드에서 시작한다)
        stopEvent: (e) => e.target === caption || sizes.contains(e.target as globalThis.Node) || e.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
});

/** 쪽 나눔 — PDF 에서 여기부터 새 쪽. */
const PageBreak = Node.create<{ messages: Messages }>({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { messages: ko };
  },
  parseHTML() {
    return [{ tag: "div[data-page-break]" }, { tag: "div", getAttrs: (el) => (/page-break-(after|before)\s*:\s*always/i.test((el as HTMLElement).getAttribute("style") ?? "") ? null : false) }];
  },
  renderHTML() {
    return ["div", { class: "md-pagebreak", "data-page-break": "", "data-label": this.options.messages.pageBreak, contenteditable: "false" }];
  },
});

const MdShade = Mark.create({
  name: "mdShade",
  parseHTML() {
    return [{ tag: "mark.md-shade" }, { tag: "mark[data-shade]" }];
  },
  renderHTML() {
    return ["mark", { class: "md-shade" }, 0];
  },
});

/** 형광펜 ==글== */
const MdHighlight = Mark.create({
  name: "mdHighlight",
  parseHTML() {
    return [
      { tag: "mark", getAttrs: (el) => ((el as HTMLElement).classList.contains("md-shade") || (el as HTMLElement).hasAttribute("data-shade") ? false : null) },
      // 워드 · 구글 문서의 형광펜(글자에 단 노란 배경). 표 칸의 채우기 색(엑셀)은 형광펜이 아니다
      { tag: "span", getAttrs: (el) => (/^(yellow|#ff0|#ffff00|rgb\(255,\s*255,\s*0\))$/i.test((el as HTMLElement).style.backgroundColor.trim()) ? null : false) },
    ];
  },
  renderHTML() {
    return ["mark", { class: "md-mark", style: `background:${MARK}` }, 0];
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))/g, type: this.type })];
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name) };
  },
});

const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() {
    return [{ tag: "sup" }, { style: "vertical-align", getAttrs: (v) => (v === "super" ? null : false) }];
  },
  renderHTML() {
    return ["sup", 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-.": () => this.editor.commands.toggleMark(this.name) };
  },
});

const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() {
    return [{ tag: "sub" }, { style: "vertical-align", getAttrs: (v) => (v === "sub" ? null : false) }];
  },
  renderHTML() {
    return ["sub", 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-,": () => this.editor.commands.toggleMark(this.name) };
  },
});

/** 인라인 코드 — 다른 서식과 겹쳐 쓸 수 있다(MD 에서 **`코드`** 가 된다). */
const MdCode = Code.extend({ excludes: "" });

/** 붙여 넣은 글자 색을 우리 색 이름으로(빨강·파랑·회색). 그 밖의 색은 버린다. */
export function colorName(css: string | null | undefined): string | null {
  if (!css) return null;
  let r: number, g: number, b: number;
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgb = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else if (/^red$/i.test(css.trim())) {
    return "빨강";
  } else if (/^blue$/i.test(css.trim())) {
    return "파랑";
  } else if (/^gr[ae]y$/i.test(css.trim())) {
    return "회색";
  } else {
    return null;
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (r >= 150 && g <= 100 && b <= 100) return "빨강";
  if (b >= 120 && r <= 110 && b - r >= 50) return "파랑";
  if (max - min <= 30 && max >= 90 && max <= 200) return "회색";
  return null;
}

const MdColor = Mark.create({
  name: "mdColor",
  addAttributes() {
    return { name: { default: "빨강" } };
  },
  parseHTML() {
    const named = (el: HTMLElement) => {
      const own = el.getAttribute("data-color");
      const name = own && isColor(own) ? own : colorName(el.style.color || el.getAttribute("color")); // 바깥에서 붙인 색은 세 색으로 줄인다
      return name ? { name } : false;
    };
    return [
      { tag: "span[data-color]", getAttrs: (el) => named(el as HTMLElement) },
      { tag: "font[color]", getAttrs: (el) => named(el as HTMLElement) },
      { style: "color", getAttrs: (value) => (colorName(String(value)) ? { name: colorName(String(value)) } : false) },
    ];
  },
  renderHTML({ mark }) {
    return ["span", { "data-color": mark.attrs.name, style: isColor(mark.attrs.name) ? `color:${colorCss(mark.attrs.name)}` : "" }, 0];
  },
});

const cellAttrs = {
  shade: {
    default: false,
    parseHTML: (el: HTMLElement) => el.hasAttribute("data-shade"),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.shade ? { "data-shade": "", style: `background:${SHADE}` } : {}),
  },
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const a = el.getAttribute("data-align") || el.style.textAlign || el.getAttribute("align");
      return a === "left" || a === "center" || a === "right" ? a : null;
    },
    renderHTML: (attrs: Record<string, unknown>) => (attrs.align ? { "data-align": attrs.align, style: `text-align:${attrs.align}` } : {}),
  },
};

// 표 칸에는 문단과 그림을 둔다(그림은 칸 안에서 한 줄을 차지한다 — MD 로는 칸 글 안의 ![설명](주소){width=N%})
const MdCell = TableCell.extend({
  content: "(paragraph | mdImage)+",
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

const MdHeaderCell = TableHeader.extend({
  content: "(paragraph | mdImage)+",
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

const MdTable = Table.extend({
  addAttributes() {
    // 본문 행이 없을 때 열 정렬을 잃지 않도록 표에 원래 값을 둔다
    return { ...this.parent?.(), align: { default: null, rendered: false } };
  },
});

export type RichOptions = {
  /** 그림 이름 → 화면에 그릴 주소. 없으면 그림 자리만 보인다. */
  resolveImage?: ImageResolver;
  messages?: Messages;
};

export function richExtensions(options: RichOptions = {}): AnyExtension[] {
  const messages = options.messages ?? ko;
  return [
    MdDoc,
    StarterKit.configure({
      document: false,
      paragraph: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      code: false,
      codeBlock: { languageClassPrefix: "language-", enableTabIndentation: true, tabSize: 4, HTMLAttributes: { class: "md-code" } },
      horizontalRule: { HTMLAttributes: { class: "md-rule" } },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        isAllowedUri: (url) => safeHref(url) !== null,
      },
    }),
    MdParagraph,
    DocTitle,
    SectionHead,
    BlockTitle,
    MdList,
    MdItem.configure({ messages }),
    MdNote,
    MdImage.configure({ resolve: options.resolveImage ?? (() => undefined), messages }),
    PageBreak.configure({ messages }),
    MdShade,
    MdHighlight,
    MdColor,
    Superscript,
    Subscript,
    MdCode,
    MdTable.configure({ resizable: false }),
    TableRow,
    MdHeaderCell,
    MdCell,
    ListNumbers,
    CellSelectionGuard,
  ];
}
