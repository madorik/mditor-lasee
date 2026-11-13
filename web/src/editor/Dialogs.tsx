import { useState } from "react";
import * as api from "../lib/api";
import { FONT_CSS, FONTS, type FontKey } from "../lib/fonts";
import { t } from "../lib/i18n";
import type { DocSummary, StoredDoc } from "../lib/store";
import type { Doc, Options } from "../lib/types";
import { Modal, when } from "./ui";

/** 쪽 설정에 보일 글꼴 이름 */
const fontLabel = (f: FontKey): string =>
  ({ pretendard: t("Pretendard (고딕, 기본)"), "nanum-myeongjo": t("나눔명조 (명조)"), "nanum-gothic": t("나눔고딕 (고딕)"), "nanum-pen": t("나눔손글씨 펜 (손글씨)") })[f];

/** 도구 막대에 보일 짧은 글꼴 이름 */
const fontShort = (f: FontKey): string =>
  ({ pretendard: "Pretendard", "nanum-myeongjo": t("나눔명조"), "nanum-gothic": t("나눔고딕"), "nanum-pen": t("나눔손글씨 펜") })[f];

const SIZES = Array.from({ length: 13 }, (_, i) => 8 + i * 0.5); // 8 ~ 14pt — 쪽 설정과 같은 범위

/** 도구 막대의 글꼴 · 글자 크기. 고른 글자가 아니라 문서 전체에 적용된다(쪽 설정과 같은 값). */
export function FontPicker({ options, onChange }: { options: Options; onChange: (o: Options) => void }) {
  const sizes = SIZES.includes(options.font_size) ? SIZES : [...SIZES, options.font_size].sort((a, b) => a - b);
  return (
    <>
      <select
        className="font-pick"
        aria-label={t("글꼴")}
        title={t("문서 전체 글꼴")}
        value={options.font}
        onChange={(e) => onChange({ ...options, font: e.target.value as FontKey })}
        style={{ fontFamily: FONT_CSS[options.font] }}
      >
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: FONT_CSS[f] }}>
            {fontShort(f)}
          </option>
        ))}
      </select>
      <select
        className="size-pick"
        aria-label={t("글자 크기")}
        title={t("문서 전체 글자 크기")}
        value={String(options.font_size)}
        onChange={(e) => onChange({ ...options, font_size: Number(e.target.value) })}
      >
        {sizes.map((s) => (
          <option key={s} value={String(s)}>
            {s}pt
          </option>
        ))}
      </select>
    </>
  );
}

export function SettingsDialog({ options, onChange, onClose }: { options: Options; onChange: (o: Options) => void; onClose: () => void }) {
  const set = <K extends keyof Options>(key: K, value: Options[K]) => onChange({ ...options, [key]: value });
  return (
    <Modal title={t("쪽 설정")} onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>{t("닫기")}</button>}>
      <p>{t("바꾸면 미리보기의 쪽 경계와 PDF 에 바로 반영됩니다.")}</p>
      <label className="field">
        <span>{t("글꼴")}</span>
        <select value={options.font} onChange={(e) => set("font", e.target.value as FontKey)} style={{ fontFamily: FONT_CSS[options.font] }}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: FONT_CSS[f] }}>
              {fontLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("용지")}</span>
        <select value={options.page} onChange={(e) => set("page", e.target.value as Options["page"])}>
          <option value="A4">A4 (210 × 297mm)</option>
          <option value="Letter">Letter (216 × 279mm)</option>
        </select>
      </label>
      <label className="field">
        <span>{t("방향")}</span>
        <select value={options.landscape ? "l" : "p"} onChange={(e) => set("landscape", e.target.value === "l")}>
          <option value="p">{t("세로")}</option>
          <option value="l">{t("가로")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("여백 (mm)")}</span>
        <input type="number" min={8} max={40} step={1} value={options.margin_mm} onChange={(e) => set("margin_mm", Math.min(40, Math.max(8, Number(e.target.value) || 20)))} />
      </label>
      <label className="field">
        <span>{t("글자 크기 (pt)")}</span>
        <input type="number" min={8} max={14} step={0.5} value={options.font_size} onChange={(e) => set("font_size", Math.min(14, Math.max(8, Number(e.target.value) || 10.5)))} />
      </label>
      <label className="check">
        <input type="checkbox" checked={options.section_break} onChange={(e) => set("section_break", e.target.checked)} />
        {t("큰 제목(섹션)마다 새 쪽에서 시작")}
      </label>
      <label className="check">
        <input type="checkbox" checked={options.page_numbers} onChange={(e) => set("page_numbers", e.target.checked)} />
        {t("쪽 번호 넣기")}
      </label>
    </Modal>
  );
}

export function VersionsDialog({ stored, onRestore, onClose }: { stored: StoredDoc; onRestore: (md: string) => void; onClose: () => void }) {
  const versions = [...stored.versions].reverse();
  return (
    <Modal title={t("판본")} onClose={onClose}>
      <p>{t("저장할 때마다 판본이 남습니다(최근 50개). 지난 판본으로 되돌리면 그 내용으로 새 판본이 생기고, 사이의 판본은 그대로 남습니다.")}</p>
      {versions.length === 0 ? (
        <p>{t("아직 저장한 판본이 없습니다.")}</p>
      ) : (
        <ul className="rows">
          {versions.map((v, i) => (
            <li key={v.n} className={i === 0 ? "on" : undefined}>
              <span className="name">{t("판본 {n}", { n: v.n })}{i === 0 ? ` · ${t("지금 저장본")}` : ""}</span>
              <time>{when(v.at)}</time>
              {i > 0 && (
                <button type="button" className="btn" onClick={() => onRestore(v.md)}>
                  {t("이 판본으로 되돌리기")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function DocsDialog({ docs, currentId, onOpen, onNew, onImport, onDelete, onClose }: { docs: DocSummary[]; currentId: string; onOpen: (id: string) => void; onNew: () => void; onImport: () => void; onDelete: (id: string) => void; onClose: () => void }) {
  return (
    <Modal
      title={t("내 문서")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onImport}>{t("파일 열기")}</button>
          <button type="button" className="btn primary" onClick={onNew}>{t("새 문서")}</button>
        </>
      }
    >
      <p>{t("문서는 이 브라우저에만 보관됩니다. 다른 기기에서 쓰려면 MD 로 내려받아 옮기세요.")}</p>
      <ul className="rows">
        {docs.map((d) => (
          <li key={d.id} className={d.id === currentId ? "on" : undefined}>
            <button type="button" className="name" onClick={() => onOpen(d.id)}>{d.name || t("이름 없는 문서")}</button>
            <time>{when(d.updatedAt)}</time>
            <button
              type="button"
              className="btn quiet danger"
              onClick={() => {
                if (window.confirm(t("‘{name}’ 을 지울까요? 판본까지 모두 지워지고 되돌릴 수 없습니다.", { name: d.name || t("이름 없는 문서") }))) onDelete(d.id);
              }}
            >
              {t("지우기")}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function AiDialog({ md, base, maxChars, onApply, onClose }: { md: string; base: Doc | null; maxChars: number; onApply: (md: string) => void; onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.Revision | null>(null);
  const tooLong = md.length > maxChars;

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.revise(md, instruction, base));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("AI 수정에 실패했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("AI 로 고치기")}
      onClose={onClose}
      wide
      footer={
        result?.changed ? (
          <>
            <button type="button" className="btn" onClick={() => setResult(null)}>{t("다시 요청")}</button>
            <button type="button" className="btn primary" onClick={() => onApply(result.md)}>{t("문서에 적용")}</button>
          </>
        ) : (
          <button type="button" className="btn primary" disabled={busy || !instruction.trim() || tooLong} onClick={run}>
            {busy ? t("고치는 중") : t("수정안 받기")}
          </button>
        )
      }
    >
      <p>{t("AI 가 지금 문서(MD)를 받아 고친 MD 를 돌려줍니다. 적용하기 전에는 문서가 바뀌지 않고, 적용한 뒤에도 저장하기 전까지는 저장본이 그대로입니다.")}</p>
      <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("예: 2장의 문장을 개조식으로 다듬어 줘. 숫자는 바꾸지 말 것.")} aria-label={t("무엇을 고칠지")} disabled={busy} maxLength={4000} />
      {tooLong && <p className="errline">{t("AI 수정은 {max}자까지의 문서에 쓸 수 있습니다. 지금 문서는 {len}자입니다.", { max: maxChars.toLocaleString(), len: md.length.toLocaleString() })}</p>}
      {error && <p className="errline">{error}</p>}
      {result && !result.changed && <div className="result">{t("바꿀 곳을 찾지 못했습니다. 지시를 더 구체적으로 적어 보세요.")}</div>}
      {result?.changed && (
        <div className="result">
          <strong>{t("수정안이 준비됐습니다.")}</strong>
          <ul>
            <li>{t("바뀐 곳: {where}", { where: result.sections.join(", ") || t("본문") })}</li>
            {result.changes && (
              <li>
                {t("고친 블록 {modified}개 · 새 블록 {added}개 · 지운 블록 {removed}개 (저장본과 견줌)", { modified: result.changes.modified.length, added: result.changes.added.length, removed: result.changes.removed.length })}
              </li>
            )}
            {result.new_numbers.length > 0 && (
              <li className="nums">
                {t("원래 문서에 없던 숫자: {numbers} — 근거가 있는 수치인지 확인하세요.", { numbers: result.new_numbers.slice(0, 30).join(", ") + (result.new_numbers.length > 30 ? " …" : "") })}
              </li>
            )}
          </ul>
        </div>
      )}
    </Modal>
  );
}
