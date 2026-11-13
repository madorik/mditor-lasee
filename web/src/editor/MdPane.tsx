import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { insertBreak, insertTable, lineRange, prefixLines, wrapSelection, type Edit } from "../lib/mdedit";
import type { MdError } from "../lib/types";

export type MdPaneHandle = { insert: (text: string) => void };

/** MD 탭 — 글 그대로 고친다. 오류가 있으면 줄 번호와 함께 알려 준다. */
export function MdPane({ value, onChange, error, onPickImage, handle }: { value: string; onChange: (v: string) => void; error: MdError | null; onPickImage: () => void; handle?: Ref<MdPaneHandle> }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split("\n").length, [value]);

  const apply = useCallback(
    (edit: Edit) => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
      // 되돌리기(Ctrl+Z)가 이어지도록 브라우저의 입력으로 넣는다
      if (!document.execCommand("insertText", false, edit.text)) {
        onChange(el.value.slice(0, edit.start) + edit.text + el.value.slice(edit.end));
      }
      requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd));
    },
    [onChange],
  );

  useImperativeHandle(handle, () => ({
    insert(text: string) {
      const el = ta.current;
      if (!el) return;
      const stop = el.value.indexOf("\n", el.selectionEnd);
      const at = stop < 0 ? el.value.length : stop;
      apply({ start: at, end: at, text: `\n\n${text}\n`, selStart: at + 2, selEnd: at + 2 + text.length });
    },
  }));

  const sel = () => {
    const el = ta.current!;
    return [el.value, el.selectionStart, el.selectionEnd] as const;
  };
  const wrap = (open: string, close: string) => () => apply(wrapSelection(...sel(), open, close));
  const prefix = (p: string) => () => apply(prefixLines(...sel(), p));

  const jump = () => {
    const el = ta.current;
    if (!el || !error?.line) return;
    const [from, to] = lineRange(el.value, error.line);
    el.focus();
    el.setSelectionRange(from, to);
    el.scrollTop = Math.max(0, (error.line - 4) * 21);
  };

  useEffect(() => {
    if (gutter.current && ta.current) gutter.current.scrollTop = ta.current.scrollTop;
  }, [lines]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrap("**", "**")();
    } else if (mod && e.key.toLowerCase() === "u") {
      e.preventDefault();
      wrap("{밑줄}", "{/밑줄}")();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      apply({ start: el.selectionStart, end: el.selectionEnd, text: "  ", selStart: el.selectionStart + 2, selEnd: el.selectionStart + 2 });
    }
  };

  return (
    <div className="mdpane">
      <div className="tools" role="toolbar" aria-label="글 서식">
        <button type="button" className="tool word" onClick={prefix("## ")} title="큰 제목(섹션)">큰 제목</button>
        <button type="button" className="tool word" onClick={prefix("### ")} title="작은 제목(블록)">작은 제목</button>
        <button type="button" className="tool word" onClick={prefix("- ")} title="목록">목록</button>
        <button type="button" className="tool word" onClick={prefix("> ")} title="비고">비고</button>
        <span className="sep" />
        <button type="button" className="tool" onClick={wrap("**", "**")} title="굵게 (Ctrl+B)"><b className="ga">가</b></button>
        <button type="button" className="tool" onClick={wrap("~~", "~~")} title="취소선"><s className="ga">가</s></button>
        <button type="button" className="tool" onClick={wrap("{밑줄}", "{/밑줄}")} title="밑줄 (Ctrl+U)"><u className="ga">가</u></button>
        <button type="button" className="tool" onClick={wrap("{음영}", "{/음영}")} title="음영"><mark className="ga" style={{ background: "#d9d9d9", padding: "0 3px" }}>가</mark></button>
        <button type="button" className="tool" onClick={wrap("{빨강}", "{/빨강}")} title="빨강"><span className="ga" style={{ color: "#c00000" }}>가</span></button>
        <button type="button" className="tool" onClick={wrap("{파랑}", "{/파랑}")} title="파랑"><span className="ga" style={{ color: "#1f4e9b" }}>가</span></button>
        <button type="button" className="tool" onClick={wrap("{회색}", "{/회색}")} title="회색"><span className="ga" style={{ color: "#7f7f7f" }}>가</span></button>
        <span className="sep" />
        <button type="button" className="tool word" onClick={() => apply(insertBreak(sel()[1], sel()[2]))} title="줄바꿈 <br>">줄바꿈</button>
        <button type="button" className="tool word" onClick={() => apply(insertTable(sel()[0], sel()[2]))} title="표 넣기">표</button>
        <button type="button" className="tool word" onClick={onPickImage} title="그림 넣기">그림</button>
      </div>
      {error ? (
        <button type="button" className="mderror" onClick={jump} title="오류가 난 줄로 가기">
          <b>{error.line ? `${error.line}번째 줄` : "오류"}</b>
          <span>{error.message}</span>
        </button>
      ) : (
        <span />
      )}
      <div className="mdedit">
        <div className="gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={error?.line === i + 1 ? "bad" : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={ta}
          value={value}
          wrap="off"
          spellCheck={false}
          aria-label="Markdown 원본"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
    </div>
  );
}
