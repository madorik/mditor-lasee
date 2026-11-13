import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as api from "../lib/api";
import { clearDraft, readDraft, writeDraft, type Draft } from "../lib/drafts";
import { lang, LANG_NAMES, langPath, localPath, otherLang, t } from "../lib/i18n";
import { imageName, readImage } from "../lib/images";
import { FONT_CSS } from "../lib/fonts";
import { dialectOf, type Dialect } from "../lib/inline";
import { encodeLink } from "../lib/share";
import { isPersistent, putDoc, withVersion, type StoredDoc } from "../lib/store";
import type { Doc, Preview as PreviewResult } from "../lib/types";
import { AdSlot } from "./AdSlot";
import { AiDialog, SettingsDialog, VersionsDialog } from "./Dialogs";
import { MdPane, type MdPaneHandle } from "./MdPane";
import { PdfPreview } from "./PdfPreview";
import { Preview } from "./Preview";
import { Menu, MOD, Tabs, useDebounced, when } from "./ui";

// 편집기 코드는 늦게 불러온다(TipTap 묶음이 크다)
const RichEditor = lazy(() => import("./RichEditor"));

const EMPTY: Doc = { title: "", sections: [] };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileStem = (name: string) => name.replace(/[\\/:*?"<>|]+/g, " ").trim() || t("문서");

/** 머리의 '파일' 메뉴가 부르는 것 — 문서를 바꿔 여는 일은 App 이 한다. */
export type FileActions = { newDoc: () => void; openFile: () => void; myDocs: () => void; example: () => void };

type Props = {
  stored: StoredDoc;
  /** 아직 이 브라우저에 보관하지 않은 문서(예시). 임시저장도 하지 않는다. */
  temp: boolean;
  config: api.Config;
  onStored: (doc: StoredDoc) => void;
  file: FileActions;
};

export function Workspace({ stored, temp, config, onStored, file }: Props) {
  // 임시저장이 있으면 이어서 연다
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(stored.id);
    return d && d.md !== stored.md ? d : null;
  });
  const [text, setText] = useState(() => draft?.md ?? stored.md);
  const [leftTab, setLeftTab] = useState<"doc" | "md">("doc");
  const [rightTab, setRightTab] = useState<"screen" | "pdf">("screen");
  const [side, setSide] = useState<"edit" | "view">("edit");
  const [dialog, setDialog] = useState<null | "versions" | "settings" | "ai">(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [name, setName] = useState(stored.name);
  const [busy, setBusy] = useState(false);

  // 문서 편집기: 서버가 되읽은 문서로 연다. key 를 올리면 새로 연다.
  const [rich, setRich] = useState<{ key: number; doc: Doc } | null>(null);
  const sent = useRef<string | null>(null); // 편집기가 스스로 만든 MD — 이걸로는 다시 열지 않는다(커서가 튀지 않게)
  const opened = useRef<string | null>(null); // 편집기를 연 MD
  const lastDoc = useRef<Doc | null>(stored.base); // 직전에 되읽은 문서 — id 를 잇는 기준
  const docFor = useRef(new Map<string, Doc>()); // MD → 되읽은 문서(쪽 배치·PDF 요청이 같은 id 를 쓰도록)
  const shown = useRef<Doc>(stored.base ?? EMPTY); // 마지막으로 제대로 읽힌 문서(오류 중에도 미리보기를 유지)
  const insertImage = useRef<((name: string) => void) | null>(null);
  const mdPane = useRef<MdPaneHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const say = useCallback((message: string, bad = false) => {
    setToast({ text: message, bad });
    window.setTimeout(() => setToast((t) => (t?.text === message ? null : t)), bad ? 6000 : 2600);
  }, []);

  const baseVersion = stored.versions.length;
  // 문서의 태그 언어 — 문서에 처음 나오는 태그를 따르고, 태그가 없으면 화면 언어. 서버(md.parse)와 같은 규칙이다.
  const dialect: Dialect = useMemo(() => dialectOf(text) ?? lang, [text]);
  const dText = useDebounced(text, 300);
  const pText = useDebounced(text, 1200);

  // ── 미리보기(300ms): 되읽은 문서 · 변경 표시 · 오류 줄. 저장하지 않는다.
  const previewQ = useQuery({
    queryKey: ["preview", stored.id, baseVersion, dText],
    queryFn: async ({ signal }) => {
      const r = await api.preview(dText, stored.base, lastDoc.current, signal);
      if (r.ok) {
        lastDoc.current = r.doc;
        docFor.current.set(dText, r.doc);
        if (docFor.current.size > 8) docFor.current.delete(docFor.current.keys().next().value!);
      }
      return r;
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: 1,
  });
  const result: PreviewResult | undefined = previewQ.data;
  // 되읽은 문서는 "지금 text 로 만든 결과"일 때만 쓴다 — 이전 결과(placeholder)나 가져오는 중인 결과는 쓰지 않는다
  const fresh = !!result && !previewQ.isPlaceholderData && dText === text;
  if (result?.ok) shown.current = result.doc;
  const error = result && !result.ok && !previewQ.isPlaceholderData ? result.error : null;

  // ── 쪽 배치(1.2s): PDF 를 실제로 그려 본 결과
  const pDoc = docFor.current.get(pText) ?? null;
  const sizes = useMemo(() => Object.fromEntries(Object.entries(stored.images).map(([k, v]) => [k, [v.w, v.h] as [number, number]])), [stored.images]);
  const pagesQ = useQuery({
    queryKey: ["pages", stored.id, pText, stored.options, sizes],
    queryFn: ({ signal }) => api.pages({ md: pText, base: pDoc, options: stored.options, image_sizes: sizes }, signal),
    enabled: !!pDoc,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 30_000,
  });
  const layout = pagesQ.data ?? null;
  const pagesStale = pText !== text || pagesQ.isPlaceholderData || pagesQ.isFetching;

  // ── PDF(1.2s): 보는 중일 때만
  const pdfQ = useQuery({
    queryKey: ["pdf", stored.id, pText, stored.options, sizes],
    queryFn: ({ signal }) =>
      api.pdf(
        { md: pText, base: pDoc, options: stored.options, image_sizes: sizes, images: Object.fromEntries(Object.entries(stored.images).map(([k, v]) => [k, v.data])) },
        false,
        signal,
      ),
    enabled: rightTab === "pdf" && !!pDoc,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 15_000,
    retry: false,
  });

  // ── 문서 편집기 열기: 밖에서 MD 가 바뀌었을 때만(AI 수정안, MD 탭에서 고침, 판본 되돌리기 …)
  useEffect(() => {
    if (leftTab !== "doc" || !fresh || !result?.ok) return;
    if (text === sent.current || text === opened.current) return;
    opened.current = text;
    setRich((r) => ({ key: (r?.key ?? 0) + 1, doc: result.doc }));
  }, [leftTab, fresh, result, text]);

  /** 밖에서 MD 를 바꾼다 — 편집기를 내렸다가 되읽은 문서로 새로 연다(옛 내용 위에 덮어쓰지 않도록). */
  const replaceText = useCallback((md: string) => {
    sent.current = null;
    opened.current = null;
    setRich(null);
    setText(md);
  }, []);

  const switchLeft = (tab: "doc" | "md") => {
    if (tab === leftTab) return;
    // MD 탭에 갔다 오면 sent 를 비운다 — 안 그러면 옛 내용으로 열려 앞서 고친 것이 덮인다
    sent.current = null;
    opened.current = null;
    if (tab === "doc") setRich(null);
    setLeftTab(tab);
  };

  const onRichChange = useCallback((md: string) => {
    sent.current = md;
    setText(md);
  }, []);

  // ── 임시저장 · 창 닫기 막기
  const dirty = text !== stored.md;
  useEffect(() => {
    if (temp) return;
    const t = setTimeout(() => {
      if (text !== stored.md) writeDraft(stored.id, { md: text, at: Date.now(), version: baseVersion });
      else clearDraft(stored.id);
    }, 400);
    return () => clearTimeout(t);
  }, [text, stored.md, stored.id, baseVersion, temp]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  /** 브라우저에 보관한 뒤에 화면에 반영한다 — '저장됨' 이 보이면 정말 보관된 것이다. */
  const persist = useCallback(
    async (next: StoredDoc) => {
      await putDoc(next);
      onStored(next);
    },
    [onStored],
  );

  /** 저장 = 새 판본. 서버가 되읽은 문서(표준 꼴 MD)를 저장한다. */
  const saveText = useCallback(
    async (md: string): Promise<boolean> => {
      setBusy(true);
      try {
        const r = md === text && fresh && result ? result : await api.preview(md, stored.base, lastDoc.current);
        if (!r.ok) {
          say(`${t("저장하지 못했습니다.")} ${r.error.line ? `${t("{line}번째 줄", { line: r.error.line })}: ` : ""}${r.error.message}`, true);
          return false;
        }
        const next = withVersion({ ...stored, name }, r.md, r.doc);
        await putDoc(next);
        clearDraft(stored.id);
        setDraft(null);
        onStored(next);
        if (r.md !== text) {
          if (leftTab === "md" || md !== text) replaceText(r.md);
          else setText(r.md);
        }
        say(t("저장했습니다"));
        return true;
      } catch (e) {
        say(e instanceof Error ? e.message : t("저장하지 못했습니다."), true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [text, fresh, result, stored, name, onStored, say, leftTab, replaceText],
  );

  const save = useCallback(() => {
    if (!busy) void saveText(text);
  }, [busy, saveText, text]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save]);

  // ── 그림
  const addImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await readImage(file);
      const total = Object.values(stored.images).reduce((n, v) => n + v.data.length * 0.75, 0) + img.data.length * 0.75;
      if (total > config.maxImageBytes) throw new Error(t("그림은 문서마다 합쳐서 {mb}MB 까지 붙일 수 있습니다.", { mb: Math.round(config.maxImageBytes / 1_000_000) }));
      const id = imageName(file, stored.images);
      await persist({ ...stored, images: { ...stored.images, [id]: img } });
      if (leftTab === "doc") insertImage.current?.(id);
      else mdPane.current?.insert(`![](${id})`);
    } catch (e) {
      say(e instanceof Error ? e.message : t("그림을 붙이지 못했습니다."), true);
    }
  };

  // ── 내보내기
  const exportPdf = async () => {
    setBusy(true);
    try {
      const { blob } = await api.pdf(
        { md: text, base: docFor.current.get(text) ?? stored.base, options: stored.options, image_sizes: sizes, images: Object.fromEntries(Object.entries(stored.images).map(([k, v]) => [k, v.data])), filename: fileStem(name) },
        true,
      );
      download(blob, `${fileStem(name)}.pdf`);
    } catch (e) {
      say(e instanceof Error ? e.message : t("PDF 를 만들지 못했습니다."), true);
    } finally {
      setBusy(false);
    }
  };
  const exportMd = () => download(new Blob([text], { type: "text/markdown;charset=utf-8" }), `${fileStem(name)}.md`);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(await encodeLink(location.origin, text));
      say(t("링크를 복사했습니다. 문서 내용이 링크 안에 들어 있습니다(그림은 빠집니다)."));
    } catch {
      say(t("링크를 복사하지 못했습니다."), true);
    }
  };

  const rename = () => {
    const next = name.trim() || t("이름 없는 문서");
    setName(next);
    if (next !== stored.name) void persist({ ...stored, name: next });
  };

  const changes = result?.ok ? result.changes : null;
  const changeCount = changes ? changes.added.length + changes.modified.length + changes.removed.length : 0;
  const viewDoc = shown.current;

  return (
    <div className="app">
      <div>
        <header className="top">
          <a className="brand" href={localPath("/")} title={t("MDitor 첫 화면")}>
            MD<i>itor</i>
          </a>
          <Menu label={t("파일")} align="left" className="btn quiet">
            {(close) => (
              <>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), file.newDoc())}>{t("새 문서")}</button>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), file.openFile())}>
                  {t("파일 열기…")} <small>{MOD}O</small>
                </button>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), file.myDocs())}>{t("내 문서")}</button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), file.example())}>{t("예시 문서 보기")}</button>
              </>
            )}
          </Menu>
          <input className="docname" value={name} aria-label={t("문서 이름")} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          <span className="spacer" />
          <div className="mobile-switch">
            <Tabs label={t("화면 전환")} value={side} onChange={setSide} items={[["edit", t("편집")], ["view", t("미리보기")]]} />
          </div>
          <span className={`state ${dirty ? "dirty" : ""}`}>{dirty ? t("저장 안 한 변경") : stored.versions.length ? t("판본 {n} 저장됨", { n: stored.versions[stored.versions.length - 1].n }) : t("저장 전")}</span>
          <button type="button" className="btn primary" disabled={busy || (!dirty && stored.versions.length > 0)} onClick={save} title={t("저장 (Ctrl+S)")}>
            {t("저장")}
          </button>
          {config.ai && (
            <button type="button" className="btn" onClick={() => setDialog("ai")}>
              {t("AI 로 고치기")}
            </button>
          )}
          <Menu label={t("내보내기")}>
            {(close) => (
              <>
                <button type="button" className="menu-item" role="menuitem" disabled={busy} onClick={() => (close(), void exportPdf())}>{t("PDF 내려받기")}</button>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), exportMd())}>{t("MD 내려받기")}</button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), void copyLink())}>{t("문서가 든 링크 복사")}</button>
              </>
            )}
          </Menu>
          <Menu label={t("문서")}>
            {(close) => (
              <>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), setDialog("versions"))}>
                  {t("판본")} <small>{t("{n}개", { n: stored.versions.length })}</small>
                </button>
                <button type="button" className="menu-item" role="menuitem" onClick={() => (close(), setDialog("settings"))}>
                  {t("쪽 설정")} <small>{stored.options.page}{stored.options.landscape ? ` ${t("가로")}` : ""}</small>
                </button>
                <div className="menu-sep" />
                <a className="menu-item" role="menuitem" href={localPath("/syntax")} target="_blank" rel="noreferrer">{t("문법 안내")}</a>
                <div className="menu-sep" />
                <a className="menu-item" role="menuitem" href={langPath(otherLang, "/edit")} hrefLang={otherLang} lang={otherLang}>{LANG_NAMES[otherLang]}</a>
              </>
            )}
          </Menu>
        </header>
        {!isPersistent() && (
          <div className="notice warn">
            <span className="grow">{t("이 브라우저 창에서는 문서를 보관할 수 없습니다. 창을 닫기 전에 ‘내보내기 → MD 내려받기’ 로 챙겨 두세요.")}</span>
          </div>
        )}
        {temp && (
          <div className="notice">
            <span className="grow">{t("예시 문서입니다. 마음껏 고쳐 보세요 — 저장하면 내 문서에 들어가고, 저장하지 않으면 남지 않습니다.")}</span>
            <button type="button" className="btn" onClick={file.newDoc}>{t("새 문서")}</button>
            <button type="button" className="btn" onClick={file.openFile}>{t("파일 열기")}</button>
          </div>
        )}
        {draft && (
          <div className="notice">
            <span className="grow">{t("저장하지 않고 닫았던 글({when})을 이어서 열었습니다.", { when: when(draft.at) })}</span>
            <button type="button" className="btn" onClick={() => (clearDraft(stored.id), setDraft(null), replaceText(stored.md))}>{t("저장본으로 되돌리기")}</button>
            <button type="button" className="btn quiet" onClick={() => setDraft(null)}>{t("닫기")}</button>
          </div>
        )}
      </div>

      <main className="work" data-side={side} data-font={stored.options.font} style={{ "--doc-font": FONT_CSS[stored.options.font] } as CSSProperties}>
        <section className="pane left" aria-label={t("편집")}>
          <div className="pane-head">
            <Tabs label={t("편집 방식")} value={leftTab} onChange={switchLeft} items={[["doc", t("문서")], ["md", "MD"]]} />
            <span className="pane-info">{leftTab === "doc" ? t("보이는 모양 그대로 고칩니다") : t("Markdown 원본을 고칩니다")}</span>
          </div>
          <div className="pane-body">
            {leftTab === "md" ? (
              <MdPane value={text} dialect={dialect} onChange={setText} error={error} onPickImage={() => fileInput.current?.click()} handle={mdPane} />
            ) : rich ? (
              <Suspense fallback={<div className="hint">{t("편집기를 불러오는 중입니다")}</div>}>
                <RichEditor key={rich.key} doc={rich.doc} dialect={dialect} images={stored.images} onChange={onRichChange} onPickImage={() => fileInput.current?.click()} register={(fn) => (insertImage.current = fn)} />
              </Suspense>
            ) : error ? (
              <div className="hint">
                <strong>{t("MD 에 고칠 곳이 있어 문서 모드로 열 수 없습니다")}</strong>
                <span>{error.line ? `${t("{line}번째 줄", { line: error.line })}: ` : ""}{error.message}</span>
                <button type="button" className="btn primary" onClick={() => switchLeft("md")}>{t("MD 탭에서 고치기")}</button>
              </div>
            ) : previewQ.isError ? (
              <div className="hint">
                <strong>{t("서버에 연결하지 못했습니다")}</strong>
                <span>{previewQ.error instanceof Error ? previewQ.error.message : ""}</span>
                <button type="button" className="btn" onClick={() => void previewQ.refetch()}>{t("다시 시도")}</button>
              </div>
            ) : (
              <div className="hint">{t("문서를 여는 중입니다")}</div>
            )}
          </div>
        </section>

        <section className="pane right" aria-label={t("미리보기")}>
          <div className="pane-head">
            <Tabs label={t("미리보기 방식")} value={rightTab} onChange={setRightTab} items={[["screen", t("미리보기")], ["pdf", "PDF"]]} />
            <span className="pane-info" aria-live="polite">
              {layout ? <><b>{layout.total === 1 ? t("전체 1쪽") : t("전체 {n}쪽", { n: layout.total })}</b>{pagesStale ? ` · ${t("쪽 다시 계산 중")}` : ""}</> : t("쪽 계산 중")}
              {dirty && changeCount > 0 && <span className="chg"> · {changeCount === 1 ? t("저장본에서 바뀐 블록 1개") : t("저장본에서 바뀐 블록 {n}개", { n: changeCount })}</span>}
            </span>
          </div>
          <div className="pane-body">
            {rightTab === "screen" ? (
              <Preview doc={viewDoc} layout={layout} changes={dirty ? changes : null} images={stored.images} options={stored.options} />
            ) : (
              <PdfPreview blob={pdfQ.data?.blob ?? null} loading={pdfQ.isFetching || !pDoc} error={pdfQ.isError ? (pdfQ.error instanceof Error ? pdfQ.error.message : t("오류")) : null} />
            )}
          </div>
        </section>
      </main>

      <AdSlot config={config} slot="editor" />

      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => (void addImage(e.target.files?.[0]), (e.target.value = ""))} />
      {dialog === "settings" && <SettingsDialog options={stored.options} onChange={(options) => void persist({ ...stored, options })} onClose={() => setDialog(null)} />}
      {dialog === "versions" && (
        <VersionsDialog
          stored={stored}
          onClose={() => setDialog(null)}
          onRestore={(md) => {
            setDialog(null);
            void saveText(md).then((ok) => ok && replaceText(md));
          }}
        />
      )}
      {dialog === "ai" && (
        <AiDialog
          md={text}
          base={stored.base}
          maxChars={config.aiMaxChars}
          onClose={() => setDialog(null)}
          onApply={(md) => {
            setDialog(null);
            replaceText(md);
            say(t("수정안을 문서에 넣었습니다. 확인한 뒤 저장하세요."));
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
