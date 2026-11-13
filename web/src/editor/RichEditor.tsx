import { Extension, InputRule } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { t } from "../lib/i18n";
import { imageSrc } from "../lib/images";
import { addRowBelow, blockKind, mergeSafe, setBlockKind, setColumnAlign, toggleCellShade, type BlockKind, type CellAlign } from "../lib/rich/commands";
import type { Dialect } from "../lib/inline";
import { fromPM, toPM } from "../lib/rich/convert";
import { richExtensions } from "../lib/rich/schema";
import type { StoredImage } from "../lib/store";
import type { Doc, Options } from "../lib/types";
import { FontPicker } from "./Dialogs";
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
export default function RichEditor({ doc, dialect, images, options, onOptions, onChange, onPickImage, register }: { doc: Doc; dialect: Dialect; images: Record<string, StoredImage>; options: Options; onOptions: (o: Options) => void; onChange: (md: string) => void; onPickImage: () => void; register: (insertImage: ((name: string) => void) | null) => void }) {
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dialectRef = useRef(dialect); // 태그를 쓸 언어 — 서버가 되읽을 때와 같아야 한다
  dialectRef.current = dialect;
  const extensions = useMemo(() => [...richExtensions({ resolveImage: (src) => imageSrc(src, imagesRef.current) }), Shortcuts], []);
  const content = useMemo(() => toPM(doc), [doc]);

  const editor = useEditor({
    extensions,
    content,
    editorProps: { attributes: { class: "docstyle", "aria-label": t("문서 편집"), spellcheck: "false" } },
    onUpdate: ({ editor: e }) => onChangeRef.current(fromPM(e.getJSON(), dialectRef.current)),
  });

  useEffect(() => {
    if (!editor) return;
    register((name) => editor.chain().focus().insertContent({ type: "mdImage", attrs: { src: name, caption: "" } }).run());
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
  const color = (name: string) => () => (ui.color === name ? editor.chain().focus().unsetMark("mdColor").run() : editor.chain().focus().setMark("mdColor", { name }).run());
  const align = (a: CellAlign) => pm(setColumnAlign(a));
  const ga = t("가"); // 서식 단추의 보기 글자
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
        <button type="button" className="tool" aria-pressed={ui.bold} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleBold().run()} title={t("굵게 (Ctrl+B)")}><b className="ga">{ga}</b></button>
        <button type="button" className="tool" aria-pressed={ui.italic} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("기울임 (Ctrl+I)")}><i className="ga">{ga}</i></button>
        <button type="button" className="tool" aria-pressed={ui.strike} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("취소선")}><s className="ga">{ga}</s></button>
        <button type="button" className="tool" aria-pressed={ui.underline} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("밑줄 (Ctrl+U)")}><u className="ga">{ga}</u></button>
        <button type="button" className="tool" aria-pressed={ui.shade} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleMark("mdShade").run()} title={t("음영")}><mark className="ga" style={{ background: "#d9d9d9", padding: "0 3px" }}>{ga}</mark></button>
        <button type="button" className="tool" aria-pressed={ui.color === "빨강"} disabled={!ui.marks} onClick={color("빨강")} title={t("빨강")}><span className="ga" style={{ color: "#c00000" }}>{ga}</span></button>
        <button type="button" className="tool" aria-pressed={ui.color === "파랑"} disabled={!ui.marks} onClick={color("파랑")} title={t("파랑")}><span className="ga" style={{ color: "#1f4e9b" }}>{ga}</span></button>
        <button type="button" className="tool" aria-pressed={ui.color === "회색"} disabled={!ui.marks} onClick={color("회색")} title={t("회색")}><span className="ga" style={{ color: "#7f7f7f" }}>{ga}</span></button>
        <span className="sep" />
        <button type="button" className="tool word" disabled={ui.inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title={t("표 넣기")}>{t("표")}</button>
        <button type="button" className="tool word" disabled={ui.inTable} onClick={onPickImage} title={t("그림 넣기")}>{t("그림")}</button>
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
