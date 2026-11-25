// @watalabs/lasee-mditor/react — React 로 감싼 편집기.
//
//   import { MDitorView } from "@watalabs/lasee-mditor/react";
//   <MDitorView defaultValue={md} onChange={setMd} locale="ko" preview />

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createMDitor, type MDitor, type MDitorOptions } from "./ui/mditor";

export type MDitorViewProps = Omit<MDitorOptions, "element" | "onChange" | "markdown"> & {
  /** 처음 MD(바꿔도 다시 열지 않는다). */
  defaultValue?: string;
  /** 바깥에서 정하는 MD — 편집기의 MD 와 다르면 그것으로 다시 연다. */
  value?: string;
  onChange?: (markdown: string) => void;
  /** 편집기를 만든 뒤 한 번. */
  onReady?: (mditor: MDitor) => void;
  className?: string;
  style?: CSSProperties;
  /** 도구 막대 앞 · 뒤에 넣을 쓰는 쪽의 단추. */
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
};

/** 편집기는 처음 한 번 만든다. 바뀐 옵션은 value · editable · dialect · preview 만 따라간다(나머지는 key 를 바꿔 다시 만든다). */
export const MDitorView = forwardRef<MDitor | null, MDitorViewProps>(function MDitorView(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [mditor, setMDitor] = useState<MDitor | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const first = useRef(props);

  useEffect(() => {
    const { defaultValue, value, onReady, className: _c, style: _s, toolbarStart: _ts, toolbarEnd: _te, onChange: _o, ...rest } = first.current;
    const ed = createMDitor({ ...rest, element: host.current!, markdown: value ?? defaultValue ?? "", onChange: (md) => onChange.current?.(md) });
    setMDitor(ed);
    onReady?.(ed);
    return () => ed.destroy();
  }, []);

  useImperativeHandle(ref, () => mditor as MDitor, [mditor]);

  useEffect(() => {
    if (mditor && props.value !== undefined && props.value !== mditor.getMarkdown()) {
      try {
        mditor.setMarkdown(props.value);
      } catch {
        // 읽을 수 없는 MD — 원문 모드에서 고치게 둔다
        mditor.setMode("source");
      }
    }
  }, [mditor, props.value]);
  useEffect(() => {
    if (mditor && props.editable !== undefined) mditor.setEditable(props.editable);
  }, [mditor, props.editable]);
  useEffect(() => {
    if (mditor && props.dialect) mditor.setDialect(props.dialect);
  }, [mditor, props.dialect]);
  useEffect(() => {
    if (mditor && props.preview !== undefined && props.preview !== mditor.isPreview()) mditor.setPreview(props.preview);
  }, [mditor, props.preview]);

  return (
    <div ref={host} className={props.className} style={props.style}>
      {mditor && props.toolbarStart ? createPortal(props.toolbarStart, mditor.slot("start")) : null}
      {mditor && props.toolbarEnd ? createPortal(props.toolbarEnd, mditor.slot("end")) : null}
    </div>
  );
});

export type { MDitor, MDitorOptions };
