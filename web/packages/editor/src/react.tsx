// @mditor/editor/react — React 로 감싼 편집기.
//
//   import { MarkdownEditorView } from "@mditor/editor/react";
//   <MarkdownEditorView defaultValue={md} onChange={setMd} locale="ko" preview />

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createEditor, type MarkdownEditor, type MarkdownEditorOptions } from "./ui/editor";

export type MarkdownEditorViewProps = Omit<MarkdownEditorOptions, "element" | "onChange" | "markdown"> & {
  /** 처음 MD(바꿔도 다시 열지 않는다). */
  defaultValue?: string;
  /** 바깥에서 정하는 MD — 편집기의 MD 와 다르면 그것으로 다시 연다. */
  value?: string;
  onChange?: (markdown: string) => void;
  /** 편집기를 만든 뒤 한 번. */
  onReady?: (editor: MarkdownEditor) => void;
  className?: string;
  style?: CSSProperties;
  /** 도구 막대 앞 · 뒤에 넣을 쓰는 쪽의 단추. */
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
};

/** 편집기는 처음 한 번 만든다. 바뀐 옵션은 value · editable · dialect · preview 만 따라간다(나머지는 key 를 바꿔 다시 만든다). */
export const MarkdownEditorView = forwardRef<MarkdownEditor | null, MarkdownEditorViewProps>(function MarkdownEditorView(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<MarkdownEditor | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const first = useRef(props);

  useEffect(() => {
    const { defaultValue, value, onReady, className: _c, style: _s, toolbarStart: _ts, toolbarEnd: _te, onChange: _o, ...rest } = first.current;
    const ed = createEditor({ ...rest, element: host.current!, markdown: value ?? defaultValue ?? "", onChange: (md) => onChange.current?.(md) });
    setEditor(ed);
    onReady?.(ed);
    return () => ed.destroy();
  }, []);

  useImperativeHandle(ref, () => editor as MarkdownEditor, [editor]);

  useEffect(() => {
    if (editor && props.value !== undefined && props.value !== editor.getMarkdown()) {
      try {
        editor.setMarkdown(props.value);
      } catch {
        // 읽을 수 없는 MD — 원문 모드에서 고치게 둔다
        editor.setMode("source");
      }
    }
  }, [editor, props.value]);
  useEffect(() => {
    if (editor && props.editable !== undefined) editor.setEditable(props.editable);
  }, [editor, props.editable]);
  useEffect(() => {
    if (editor && props.dialect) editor.setDialect(props.dialect);
  }, [editor, props.dialect]);
  useEffect(() => {
    if (editor && props.preview !== undefined && props.preview !== editor.isPreview()) editor.setPreview(props.preview);
  }, [editor, props.preview]);

  return (
    <div ref={host} className={props.className} style={props.style}>
      {editor && props.toolbarStart ? createPortal(props.toolbarStart, editor.slot("start")) : null}
      {editor && props.toolbarEnd ? createPortal(props.toolbarEnd, editor.slot("end")) : null}
    </div>
  );
});

export type { MarkdownEditor, MarkdownEditorOptions };
