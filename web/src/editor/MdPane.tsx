import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { t } from "../lib/i18n";
import { tag, type Dialect } from "../lib/inline";
import { insertBreak, insertTable, lineRange, prefixLines, wrapSelection, type Edit } from "../lib/mdedit";
import type { MdError, Options } from "../lib/types";
import { FontPicker } from "./Dialogs";
import { ColorMenu, ImageButton } from "./Tools";

export type MdPaneHandle = { insert: (text: string) => void };

/** MD 탭 — 글 그대로 고친다. 오류가 있으면 줄 번호와 함께 알려 준다. */
export function MdPane({ value, dialect, onChange, error, options, onOptions, onPickImage, handle }: { value: string; dialect: Dialect; onChange: (v: string) => void; error: MdError | null; options: Options; onOptions: (o: Options) => void; onPickImage: () => void; handle?: Ref<MdPaneHandle> }) {
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
  /** 서식 태그로 감싼다 — 문서의 태그 언어로({밑줄} · {underline}) */
  const wrapTag = (name: string) => wrap(`{${tag(name, dialect)}}`, `{/${tag(name, dialect)}}`);
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
      wrapTag("밑줄")();
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrapTag("기울임")();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      apply({ start: el.selectionStart, end: el.selectionEnd, text: "  ", selStart: el.selectionStart + 2, selEnd: el.selectionStart + 2 });
    }
  };

  return (
    <div className="mdpane">
      <div className="tools" role="toolbar" aria-label={t("글 서식")}>
        <FontPicker options={options} onChange={onOptions} />
        <span className="sep" />
        <button type="button" className="tool word" onClick={prefix("## ")} title={t("큰 제목(섹션)")}>{t("큰 제목")}</button>
        <button type="button" className="tool word" onClick={prefix("### ")} title={t("작은 제목(블록)")}>{t("작은 제목")}</button>
        <button type="button" className="tool word" onClick={prefix("- ")} title={t("목록")}>{t("목록")}</button>
        <button type="button" className="tool word" onClick={prefix("> ")} title={t("비고")}>{t("비고")}</button>
        <span className="sep" />
        <button type="button" className="tool" onClick={wrap("**", "**")} title={t("굵게 (Ctrl+B)")}><b className="mark-glyph">B</b></button>
        <button type="button" className="tool" onClick={wrapTag("기울임")} title={t("기울임 (Ctrl+I)")}><i className="mark-glyph">I</i></button>
        <button type="button" className="tool" onClick={wrapTag("밑줄")} title={t("밑줄 (Ctrl+U)")}><u className="mark-glyph">U</u></button>
        <button type="button" className="tool" onClick={wrap("~~", "~~")} title={t("취소선")}><s className="mark-glyph">S</s></button>
        <ColorMenu color={null} shade={false} canClear={false} onColor={(name) => name && wrapTag(name)()} onShade={wrapTag("음영")} />
        <span className="sep" />
        <button type="button" className="tool word" onClick={() => apply(insertBreak(sel()[1], sel()[2]))} title={t("줄바꿈 <br>")}>{t("줄바꿈")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertTable(sel()[0], sel()[2]))} title={t("표 넣기")}>{t("표")}</button>
        <ImageButton onClick={onPickImage} />
      </div>
      {error ? (
        <button type="button" className="mderror" onClick={jump} title={t("오류가 난 줄로 가기")}>
          <b>{error.line ? t("{line}번째 줄", { line: error.line }) : t("오류")}</b>
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
          aria-label={t("Markdown 원본")}
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
