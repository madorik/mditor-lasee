import { Extension, InputRule } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { addRowBelow, blockKind, mergeSafe, setBlockKind, setColumnAlign, toggleCellShade, type BlockKind, type CellAlign } from "../lib/rich/commands";
import { fromPM, toPM } from "../lib/rich/convert";
import { richExtensions } from "../lib/rich/schema";
import type { StoredImage } from "../lib/store";
import type { Doc } from "../lib/types";
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
  ["paragraph", "본문"],
  ["sectionHead", "큰 제목"],
  ["blockTitle", "작은 제목"],
  ["list", "목록"],
  ["mdNote", "비고"],
  ["docTitle", "문서 제목"],
];

/**
 * 문서 탭 — 보이는 모양 그대로 고친다.
 * 서버가 되읽은 문서(doc)로 열고, 고칠 때마다 MD 로 직렬화해 올린다. 밖에서 MD 가 바뀌면 부모가 key 를 올려 새로 연다.
 */
export default function RichEditor({ doc, images, onChange, onPickImage, register }: { doc: Doc; images: Record<string, StoredImage>; onChange: (md: string) => void; onPickImage: () => void; register: (insertImage: ((name: string) => void) | null) => void }) {
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const extensions = useMemo(() => [...richExtensions({ resolveImage: (src) => (src.startsWith("data:") ? src : imagesRef.current[src]?.data) }), Shortcuts], []);
  const content = useMemo(() => toPM(doc), [doc]);

  const editor = useEditor({
    extensions,
    content,
    editorProps: { attributes: { class: "docstyle", "aria-label": "문서 편집", spellcheck: "false" } },
    onUpdate: ({ editor: e }) => onChangeRef.current(fromPM(e.getJSON())),
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
        underline: e.isActive("underline"),
        shade: e.isActive("mdShade"),
        color: e.isActive("mdColor") ? (color ?? null) : null,
        inTable: e.isActive("table"),
        marks: !["docTitle", "sectionHead", "blockTitle"].includes(e.state.selection.$from.parent.type.name),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  if (!editor || !ui) return null;

  const pm = (cmd: Command) => () => {
    cmd(editor.state, editor.view.dispatch);
    editor.view.focus();
  };
  const color = (name: string) => () => (ui.color === name ? editor.chain().focus().unsetMark("mdColor").run() : editor.chain().focus().setMark("mdColor", { name }).run());
  const align = (a: CellAlign) => pm(setColumnAlign(a));

  return (
    <div className="rich">
      <div className="tools" role="toolbar" aria-label="문서 서식">
        <select
          aria-label="블록 종류"
          value={ui.kind ?? ""}
          disabled={!ui.kind}
          onChange={(e) => {
            const kind = e.target.value as BlockKind;
            if (ui.kind !== kind) setBlockKind(kind)(editor.state, editor.view.dispatch);
            editor.view.focus();
          }}
        >
          {!ui.kind && <option value="">표·그림</option>}
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="sep" />
        <button type="button" className="tool" aria-pressed={ui.bold} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게 (Ctrl+B)"><b className="ga">가</b></button>
        <button type="button" className="tool" aria-pressed={ui.strike} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선"><s className="ga">가</s></button>
        <button type="button" className="tool" aria-pressed={ui.underline} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄 (Ctrl+U)"><u className="ga">가</u></button>
        <button type="button" className="tool" aria-pressed={ui.shade} disabled={!ui.marks} onClick={() => editor.chain().focus().toggleMark("mdShade").run()} title="음영"><mark className="ga" style={{ background: "#d9d9d9", padding: "0 3px" }}>가</mark></button>
        <button type="button" className="tool" aria-pressed={ui.color === "빨강"} disabled={!ui.marks} onClick={color("빨강")} title="빨강"><span className="ga" style={{ color: "#c00000" }}>가</span></button>
        <button type="button" className="tool" aria-pressed={ui.color === "파랑"} disabled={!ui.marks} onClick={color("파랑")} title="파랑"><span className="ga" style={{ color: "#1f4e9b" }}>가</span></button>
        <button type="button" className="tool" aria-pressed={ui.color === "회색"} disabled={!ui.marks} onClick={color("회색")} title="회색"><span className="ga" style={{ color: "#7f7f7f" }}>가</span></button>
        <span className="sep" />
        <button type="button" className="tool word" disabled={ui.inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="표 넣기">표</button>
        <button type="button" className="tool word" disabled={ui.inTable} onClick={onPickImage} title="그림 넣기">그림</button>
        <span className="sep" />
        <button type="button" className="tool word" disabled={!ui.canUndo} onClick={() => editor.chain().focus().undo().run()} title="되돌리기 (Ctrl+Z)">되돌리기</button>
        <button type="button" className="tool word" disabled={!ui.canRedo} onClick={() => editor.chain().focus().redo().run()} title="다시 하기">다시</button>
      </div>
      {ui.inTable ? (
        <div className="tools table-tools" role="toolbar" aria-label="표">
          <span className="label">표</span>
          <button type="button" className="tool word" onClick={pm(addRowBelow)}>아래에 행</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().addColumnAfter().run()}>오른쪽에 열</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteRow().run()}>행 지우기</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteColumn().run()}>열 지우기</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={pm(mergeSafe)} title="칸을 끌어서 고른 뒤 누르세요">칸 합치기</button>
          <button type="button" className="tool word" onClick={() => editor.chain().focus().splitCell().run()}>칸 나누기</button>
          <button type="button" className="tool word" onClick={pm(toggleCellShade)}>칸 음영</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={align("left")} title="열 왼쪽 정렬">왼쪽</button>
          <button type="button" className="tool word" onClick={align("center")} title="열 가운데 정렬">가운데</button>
          <button type="button" className="tool word" onClick={align("right")} title="열 오른쪽 정렬">오른쪽</button>
          <span className="sep" />
          <button type="button" className="tool word" onClick={() => editor.chain().focus().deleteTable().run()}>표 지우기</button>
        </div>
      ) : (
        <span />
      )}
      <div className="rich-scroll" onMouseDown={(e) => e.target === e.currentTarget && editor.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
