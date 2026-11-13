// 문서 편집기 스키마 — MD 와 1:1 로 맞춘다.
// 스키마에 없는 것은 붙여넣기 때 자동으로 버려진다(워드의 글자 크기·다른 글꼴 등).
//
//   docTitle (h1, 한 줄)             # 문서 제목 — 맨 앞에만
//   sectionHead (h2, 한 줄)          ## 섹션
//   blockTitle (h3, 한 줄)           ### 블록 제목      (제목에도 글 서식을 쓴다. 줄바꿈은 없다)
//   paragraph                        문단
//   mdList > mdItem{level}           - 항목 /   - 하위 (Tab / Shift-Tab)
//   table > 칸(paragraph+, shade, align)   MD 표 + < / ^ + 칸 음영
//   mdNote (blockquote)              > 비고 (줄마다 하나)
//   mdImage{src, caption} (atom)     ![설명](이름)
//   marks: bold · strike · italic · underline · mdShade · mdColor{name}
//   hardBreak                        <br>

import { Mark, Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { INLINE_COLORS, SHADE } from "../inline";
import { backspaceItem, shiftItem, splitItem } from "./commands";

// 문단을 맨 앞에 둔다 — Enter 로 새로 생기는 블록의 기본이 문단이 되도록.
const TOP = "docTitle? (paragraph | sectionHead | blockTitle | mdList | table | mdNote | mdImage)+";
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

const MdItem = Node.create({
  name: "mdItem",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 0,
        parseHTML: (el) => domLevel(el as HTMLElement),
        renderHTML: (attrs) => ({ "data-level": attrs.level }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "li" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", HTMLAttributes, 0];
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

const MdImage = Node.create<{ resolve: ImageResolver }>({
  name: "mdImage",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { resolve: () => undefined };
  },
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-src") ?? "" },
      caption: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-caption") ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-src]" }];
  },
  renderHTML({ node }) {
    return ["figure", { class: "md-image", "data-src": node.attrs.src, "data-caption": node.attrs.caption }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("figure");
      dom.className = "md-image";
      const img = document.createElement("img");
      const missing = document.createElement("div");
      missing.className = "md-image-missing";
      const caption = document.createElement("input");
      caption.className = "md-image-caption";
      caption.placeholder = "그림 설명";
      caption.setAttribute("aria-label", "그림 설명");
      dom.append(img, missing, caption);

      const paint = () => {
        const url = this.options.resolve(current.attrs.src);
        img.hidden = !url;
        missing.hidden = !!url;
        if (url) img.src = url;
        img.alt = current.attrs.caption;
        missing.textContent = `그림 '${current.attrs.src}' 을 찾을 수 없습니다`;
        if (document.activeElement !== caption) caption.value = current.attrs.caption;
      };
      const commit = () => {
        const pos = getPos();
        if (pos === undefined || caption.value === current.attrs.caption) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: caption.value }));
      };
      caption.addEventListener("input", commit);
      caption.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          caption.blur();
        }
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
        stopEvent: (e) => e.target === caption,
        ignoreMutation: () => true,
      };
    };
  },
});

const MdShade = Mark.create({
  name: "mdShade",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML() {
    return ["mark", { class: "md-shade" }, 0];
  },
});

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
      const name = own && own in INLINE_COLORS ? own : colorName(el.style.color || el.getAttribute("color"));
      return name ? { name } : false;
    };
    return [
      { tag: "span[data-color]", getAttrs: (el) => named(el as HTMLElement) },
      { tag: "font[color]", getAttrs: (el) => named(el as HTMLElement) },
      { style: "color", getAttrs: (value) => (colorName(String(value)) ? { name: colorName(String(value)) } : false) },
    ];
  },
  renderHTML({ mark }) {
    return ["span", { "data-color": mark.attrs.name, style: `color:${INLINE_COLORS[mark.attrs.name] ?? "inherit"}` }, 0];
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

const MdCell = TableCell.extend({
  content: "paragraph+",
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

const MdHeaderCell = TableHeader.extend({
  content: "paragraph+",
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

export function richExtensions(options: { resolveImage?: ImageResolver } = {}): AnyExtension[] {
  return [
    MdDoc,
    StarterKit.configure({
      document: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      link: false,
      horizontalRule: false,
    }),
    DocTitle,
    SectionHead,
    BlockTitle,
    MdList,
    MdItem,
    MdNote,
    MdImage.configure({ resolve: options.resolveImage ?? (() => undefined) }),
    MdShade,
    MdColor,
    MdTable.configure({ resizable: false }),
    TableRow,
    MdHeaderCell,
    MdCell,
  ];
}
