import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { t } from "../lib/i18n";
import { droppedImages } from "../lib/images";
import { tag, type Dialect } from "@watalabs/lasee-mditor/core";
import { insertBlockLine, insertBreak, insertCodeBlock, insertLink, insertTable, lineRange, prefixLines, wrapSelection, type Edit } from "../lib/mdedit";
import type { MdError, Options } from "../lib/types";
import { FontPicker } from "./Dialogs";
import { ColorMenu, ImageButton } from "./Tools";

/** insert: 지금 줄 아래에 넣는다. replace: 그림 주소를 바꾼다(null 이면 그 그림 줄을 뺀다). */
export type MdPaneHandle = { insert: (text: string) => void; replace: (from: string, to: string | null) => void };

/** MD 탭 — 글 그대로 고친다. 오류가 있으면 줄 번호와 함께 알려 준다. */
export function MdPane({ value, dialect, maxLength, maxPaste, onTooLong, onChange, error, options, onOptions, onPickImage, onImageFile, handle }: { value: string; dialect: Dialect; maxLength: number; maxPaste: number; onTooLong: (kind: "paste" | "document", length: number) => void; onChange: (v: string) => void; error: MdError | null; options: Options; onOptions: (o: Options) => void; onPickImage: () => void; onImageFile: (file: File) => void; handle?: Ref<MdPaneHandle> }) {
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
    replace(from: string, to: string | null) {
      const el = ta.current;
      if (!el || !el.value.includes(from)) return;
      const [start, end] = [el.selectionStart, el.selectionEnd];
      const next = to
        ? el.value.split(from).join(to)
        : el.value.split("\n").filter((line) => !line.includes(`](${from})`)).join("\n").replace(/\n{3,}/g, "\n\n");
      onChange(next);
      const shift = to ? to.length - from.length : 0; // 커서가 바뀐 주소 뒤에 있었으면 그만큼 민다(대개 바로 그 줄이다)
      requestAnimationFrame(() => el.setSelectionRange(Math.max(0, start + shift), Math.max(0, end + shift)));
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
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      apply(insertLink(...sel(), t("링크")));
    } else if (mod && e.key.toLowerCase() === "e") {
      e.preventDefault();
      wrap("`", "`")();
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
        <button type="button" className="tool word" onClick={prefix("1. ")} title={t("번호 목록")}>{t("번호")}</button>
        <button type="button" className="tool word" onClick={prefix("- [ ] ")} title={t("할 일 목록")}>{t("할 일")}</button>
        <button type="button" className="tool word" onClick={prefix("> ")} title={t("비고")}>{t("비고")}</button>
        <span className="sep" />
        <button type="button" className="tool" onClick={wrap("**", "**")} title={t("굵게 (Ctrl+B)")}><b className="mark-glyph">B</b></button>
        <button type="button" className="tool" onClick={wrapTag("기울임")} title={t("기울임 (Ctrl+I)")}><i className="mark-glyph">I</i></button>
        <button type="button" className="tool" onClick={wrapTag("밑줄")} title={t("밑줄 (Ctrl+U)")}><u className="mark-glyph">U</u></button>
        <button type="button" className="tool" onClick={wrap("~~", "~~")} title={t("취소선")}><s className="mark-glyph">S</s></button>
        <ColorMenu color={null} shade={false} canClear={false} onColor={(name) => name && wrapTag(name)()} onShade={wrapTag("음영")} />
        <button type="button" className="tool word" onClick={wrap("==", "==")} title={t("형광펜 ==글==")}>{t("형광펜")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertLink(...sel(), t("링크")))} title={t("링크 [글](주소)")}>{t("링크")}</button>
        <button type="button" className="tool word" onClick={wrap("`", "`")} title={t("인라인 코드 `글`")}>{t("코드")}</button>
        <span className="sep" />
        <button type="button" className="tool word" onClick={() => apply(insertBreak(sel()[1], sel()[2]))} title={t("줄바꿈 <br>")}>{t("줄바꿈")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertTable(sel()[0], sel()[2]))} title={t("표 넣기")}>{t("표")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertCodeBlock(...sel()))} title={t("코드 블록 ```")}>{t("코드 블록")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertBlockLine(sel()[0], sel()[2], "---"))} title={t("가로줄 ---")}>{t("가로줄")}</button>
        <button type="button" className="tool word" onClick={() => apply(insertBlockLine(sel()[0], sel()[2], "<!-- pagebreak -->"))} title={t("쪽 나눔 — PDF 에서 여기부터 새 쪽")}>{t("쪽 나눔")}</button>
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
          onPaste={(e) => {
            // 한 번에 붙이는 글이 길거나 붙이면 문서가 한도를 넘으면 붙이지 않는다(큰 글을 한 번에 붙여 서버가 무거워지지 않게)
            const el = e.currentTarget;
            const add = e.clipboardData.getData("text/plain").length;
            const next = el.value.length - (el.selectionEnd - el.selectionStart) + add;
            if (add > maxPaste || (next > maxLength && next > el.value.length)) {
              e.preventDefault();
              onTooLong(add > maxPaste ? "paste" : "document", add > maxPaste ? add : next);
              return;
            }
            const files = droppedImages(e.clipboardData);
            if (!files.length) return;
            e.preventDefault(); // 그림을 붙여 넣으면 이미지 단추와 똑같이 넣는다
            for (const f of files) onImageFile(f);
          }}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
    </div>
  );
}
