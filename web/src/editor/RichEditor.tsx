import { Extension, InputRule } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { t } from "../lib/i18n";
import { droppedImages, imageSrc } from "../lib/images";
import { addRowBelow, blockKind, mergeSafe, setBlockKind, setColumnAlign, toggleCellShade, type BlockKind, type CellAlign } from "../lib/rich/commands";
import type { Dialect } from "../lib/inline";
import { fromPM, toPM } from "../lib/rich/convert";
import { richExtensions } from "../lib/rich/schema";
import type { StoredImage } from "../lib/store";
import type { Doc, Options } from "../lib/types";
import { FontPicker } from "./Dialogs";
import { ColorMenu, ImageButton } from "./Tools";
import type { Command } from "@tiptap/pm/state";

/** 문단 맨 앞에서 MD 기호를 치면 그 블록으로 바꾼다(- 목록, ## 큰 제목, ### 작은 제목, > 비고). */
const Shortcuts = Extension.create({
  name: "mdShortcuts",
  addInputRules() {
    const rule = (find: RegExp, kind: BlockKind) =>
      new InputRule({
        find,
        handler: ({ state, range, chain }) => {
          const { $from } = state.selection;
          if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;
          chain()
            .deleteRange(range)
            .command(({ state: s, dispatch }) => setBlockKind(kind)(s, dispatch))
            .run();
        },
      });
    return [rule(/^[-*+]\s$/, "list"), rule(/^##\s$/, "sectionHead"), rule(/^###\s$/, "blockTitle"), rule(/^>\s$/, "mdNote")];
  },
});

const KINDS: [BlockKind, string][] = [
  ["paragraph", t("본문")],
  ["sectionHead", t("큰 제목")],
  ["blockTitle", t("작은 제목")],
  ["list", t("목록")],
  ["mdNote", t("비고")],
  ["docTitle", t("문서 제목")],
];

/**
 * 문서 탭 — 보이는 모양 그대로 고친다.
 * 서버가 되읽은 문서(doc)로 열고, 고칠 때마다 MD 로 직렬화해 올린다. 밖에서 MD 가 바뀌면 부모가 key 를 올려 새로 연다.
 */
/** 바깥(Workspace)에서 그림을 다루는 손잡이 — 넣기, 주소 바꾸기(올리기가 끝나면 blob: → 저장소 주소, null 이면 뺀다). */
export type ImageApi = { insert: (src: string) => void; replace: (from: string, to: string | null) => void };

export default function RichEditor({ doc, dialect, images, options, onOptions, onChange, onPickImage, onImageFile, register }: { doc: Doc; dialect: Dialect; images: Record<string, StoredImage>; options: Options; onOptions: (o: Options) => void; onChange: (md: string) => void; onPickImage: () => void; onImageFile: (file: File) => void; register: (api: ImageApi | null) => void }) {
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onChangeRef = useRef(onChange);
  const onImageFileRef = useRef(onImageFile);
  onImageFileRef.current = onImageFile;
  onChangeRef.current = onChange;
  const dialectRef = useRef(dialect); // 태그를 쓸 언어 — 서버가 되읽을 때와 같아야 한다
  dialectRef.current = dialect;
  const extensions = useMemo(() => [...richExtensions({ resolveImage: (src) => imageSrc(src, imagesRef.current) }), Shortcuts], []);
  const content = useMemo(() => toPM(doc), [doc]);

  const editor = useEditor({
    extensions,
    content,
    editorProps: {
      attributes: { class: "docstyle", "aria-label": t("문서 편집"), spellcheck: "false" },
      // 그림을 붙여 넣으면(화면 갈무리 · '이미지 복사') 이미지 단추와 똑같이 넣는다
      handlePaste: (_view, event) => {
        const files = droppedImages(event.clipboardData);
        if (!files.length) return false;
        for (const f of files) onImageFileRef.current(f);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(fromPM(e.getJSON(), dialectRef.current)),
  });

  useEffect(() => {
    if (!editor) return;
    register({
      insert: (src) => editor.chain().focus().insertContent({ type: "mdImage", attrs: { src, caption: "" } }).run(),
      replace: (from, to) => {
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
        editor.view.dispatch(tr.setMeta("addToHistory", false)); // 되돌리기로 blob: 주소가 돌아오지 않게
      },
    });
    return () => register(null);
  }, [editor, register]);

  // 그림이 늦게 붙으면(이름만 먼저 들어간 경우) 다시 그린다
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("images", Date.now()));
  }, [editor, images]);

  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const color = e.getAttributes("mdColor").name as string | undefined;
      return {
        kind: blockKind(e.state),
        bold: e.isActive("bold"),
        strike: e.isActive("strike"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        shade: e.isActive("mdShade"),
        color: e.isActive("mdColor") ? (color ?? null) : null,
        inTable: e.isActive("table"),
        marks: e.state.selection.$from.parent.type.allowsMarkType(e.state.schema.marks.bold), // 제목에도 서식을 쓴다
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  // 표 도구 막대가 나타나거나 사라지면 그 높이만큼 스크롤을 옮겨 문서가 제자리에 있게 한다.
  // (표 밖에서 칸을 끌기 시작하면 막대가 끄는 도중에 나타나 칸이 밀리고, 엉뚱한 칸이 골라졌다)
  const scroller = useRef<HTMLDivElement>(null);
  const tableBar = useRef<HTMLDivElement>(null);
  const barHeight = useRef(0);
  const inTable = !!ui?.inTable;
  useLayoutEffect(() => {
    const h = tableBar.current?.offsetHeight ?? 0;
    const delta = h - barHeight.current;
    barHeight.current = h;
    if (delta && scroller.current) scroller.current.scrollTop += delta;
  }, [inTable]);

  if (!editor || !ui) return null;

  const pm = (cmd: Command) => () => {
    cmd(editor.state, editor.view.dispatch);
    editor.view.focus();
  };
  const align = (a: CellAlign) => pm(setColumnAlign(a));
  // 단추를 눌러도 초점이 편집기에 남게 한다 — 초점이 단추로 옮겨 가는 틈에 고른 칸(칸 선택)이 글자 선택으로 바뀌어
  // 칸 합치기가 듣지 않는 일이 있었다. 고르는 칸(select)은 눌러야 열리므로 막지 않는다.
  const keepFocus = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };

  return (
    <div className="rich">
      <div className="tools" role="toolbar" aria-label={t("문서 서식")} onMouseDown={keepFocus}>
        <select
          aria-label={t("블록 종류")}
          value={ui.kind ?? ""}
          disabled={!ui.kind}
          onChange={(e) => {
            const kind = e.target.value as BlockKind;
            if (ui.kind !== kind) setBlockKind(kind)(editor.state, editor.view.dispatch);
            editor.view.focus();
          }}
        >
          {!ui.kind && <option value="">{t("표·그림")}</option>}
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <FontPicker options={options} onChange={onOptions} />
        <span className="sep" />
        <button type="button" className="tool" aria-pressed={ui.bold} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleBold().run()} title={t("굵게 (Ctrl+B)")}><b className="mark-glyph">B</b></button>
        <button type="button" className="tool" aria-pressed={ui.italic} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("기울임 (Ctrl+I)")}><i className="mark-glyph">I</i></button>
        <button type="button" className="tool" aria-pressed={ui.underline} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("밑줄 (Ctrl+U)")}><u className="mark-glyph">U</u></button>
        <button type="button" className="tool" aria-pressed={ui.strike} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("취소선")}><s className="mark-glyph">S</s></button>
        <ColorMenu
          color={ui.color}
          shade={ui.shade}
          disabled={!ui.marks}
          canClear
          onColor={(name) => (name ? editor.chain().focus().setMark("mdColor", { name }).run() : editor.chain().focus().unsetMark("mdColor").run())}
          onShade={() => editor.chain().focus().toggleMark("mdShade").run()}
        />
        <span className="sep" />
        <button type="button" className="tool word" disabled={ui.inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title={t("표 넣기")}>{t("표")}</button>
        <ImageButton disabled={ui.inTable} onClick={onPickImage} />
        <span className="sep" />
        <button type="button" className="tool word" disabled={!ui.canUndo} onClick={() => editor.chain().focus().undo().run()} title={t("되돌리기 (Ctrl+Z)")}>{t("되돌리기")}</button>
        <button type="button" className="tool word" disabled={!ui.canRedo} onClick={() => editor.chain().focus().redo().run()} title={t("다시 하기")}>{t("다시")}</button>
      </div>
      {ui.inTable ? (
        <div className="tools table-tools" role="toolbar" aria-label={t("표")} ref={tableBar} onMouseDown={keepFocus}>
          <span className="label">{t("표")}</span>
          <button type="button" className="tool word" onClick={pm(addRowBelow)}>{t("아래에 행")}</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().addColumnAfter().run()}>{t("오른쪽에 열")}</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteRow().run()}>{t("행 지우기")}</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteColumn().run()}>{t("열 지우기")}</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={pm(mergeSafe)} title={t("칸을 끌어서 고른 뒤 누르세요")}>{t("칸 합치기")}</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().splitCell().run()}>{t("칸 나누기")}</button>
          <button type="button" className="tool word" onClick={pm(toggleCellShade)}>{t("칸 음영")}</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={align("left")} title={t("열 왼쪽 정렬")}>{t("왼쪽")}</button>
          <button type="button" className="tool word" onClick={align("center")} title={t("열 가운데 정렬")}>{t("가운데")}</button>
          <button type="button" className="tool word" onClick={align("right")} title={t("열 오른쪽 정렬")}>{t("오른쪽")}</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteTable().run()}>{t("표 지우기")}</button>
        </div>
      ) : (
        <span />
      )}
      <div className="rich-scroll" ref={scroller} onMouseDown={(e) => e.target === e.currentTarget && editor.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
