import { useCallback, useEffect, useRef, useState } from "react";
import exampleEn from "../../../src/mditor/data/example.en.md?raw";
import exampleKo from "../../../src/mditor/data/example.md?raw";
import * as api from "../lib/api";
import { isMdFile, MD_ACCEPT, readMdFile, stemOf } from "../lib/files";
import { lang, t } from "../lib/i18n";
import { decodeHash } from "../lib/share";
import { currentId, deleteDoc, getDoc, listDocs, newDoc, putDoc, setCurrentId, type DocSummary, type StoredDoc } from "../lib/store";
import { DocsDialog } from "./Dialogs";
import { Workspace, type FileActions } from "./Workspace";

const BLANK = t("# 제목 없는 문서\n\n## 1. 개요\n\n- 여기에 내용을 적으세요.\n");
const blankDoc = () => newDoc(t("제목 없는 문서"), BLANK);
// 예시 문서 — 화면 언어에 맞는 것(서식 태그도 그 언어로 적혀 있다)
const example = lang === "en" ? exampleEn : exampleKo;

function titleOf(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m ? m[1].trim() : fallback).slice(0, 80);
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

export function App() {
  const [config, setConfig] = useState<api.Config | null>(null);
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<StoredDoc | null>(null); // 처음 불러오는 동안만 null
  // 예시처럼 아직 이 브라우저에 보관하지 않은 문서. 저장(이름·쪽 설정·그림 포함)하면 내 문서가 된다.
  const [temp, setTemp] = useState(false);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [showDocs, setShowDocs] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mdInput = useRef<HTMLInputElement>(null);

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 6000);
  }, []);

  /** 보관하고 연다. */
  const open = useCallback(async (next: StoredDoc) => {
    await putDoc(next);
    setCurrentId(next.id);
    setTemp(false);
    setDoc(next);
    setDocs(await listDocs());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await api.loadConfig();
        if (!alive) return;
        setConfig(cfg);
        // 1) 주소에 문서가 실려 왔으면(AI·MCP 가 만든 링크) 새 문서로 연다
        const shared = await decodeHash(location.hash);
        if (shared !== null) {
          history.replaceState(null, "", location.pathname + location.search);
          await open(newDoc(titleOf(shared, t("받은 문서")), shared));
          return;
        }
        // 2) 지난번에 열어 둔 문서, 3) 가장 최근 문서, 4) 없으면 새 문서를 바로 연다
        const all = await listDocs();
        const id = currentId();
        const last = (id ? await getDoc(id) : null) ?? (all.length ? await getDoc(all[0].id) : null);
        if (!alive) return;
        if (last) {
          setDocs(all);
          setCurrentId(last.id);
          setDoc(last);
        } else {
          await open(blankDoc());
        }
      } catch (e) {
        if (alive) setFatal(e instanceof Error ? e.message : t("화면을 열지 못했습니다."));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const onStored = useCallback((next: StoredDoc) => {
    setCurrentId(next.id);
    setTemp(false);
    setDoc(next);
    setDocs((list) => [{ id: next.id, name: next.name, updatedAt: next.updatedAt }, ...list.filter((d) => d.id !== next.id)]);
  }, []);

  const newBlank = useCallback(() => {
    setShowDocs(false);
    void open(blankDoc());
  }, [open]);

  const openExample = useCallback(() => {
    setShowDocs(false);
    setTemp(true);
    setDoc(newDoc(titleOf(example, t("예시 문서")), example));
  }, []);

  const pickFile = useCallback(() => mdInput.current?.click(), []);

  const openFile = useCallback(
    async (file: File) => {
      try {
        const text = await readMdFile(file, config?.maxChars ?? 400_000);
        setShowDocs(false);
        await open(newDoc(stemOf(file.name), text));
      } catch (e) {
        say(e instanceof Error ? e.message : t("파일을 열지 못했습니다."));
      }
    },
    [config, open, say],
  );

  // 파일 열기 단축키(Ctrl/⌘+O)와 끌어다 놓기
  useEffect(() => {
    if (!ready) return;
    let depth = 0;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickFile();
      }
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // 안 막으면 브라우저가 파일로 넘어가 버린다
      e.dataTransfer!.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const file = [...e.dataTransfer!.files].find(isMdFile);
      if (file) void openFile(file);
      else say(t("MD 파일(.md)만 끌어다 놓아 열 수 있습니다. 그림은 편집기의 그림 단추로 넣으세요."));
    };
    window.addEventListener("keydown", key);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [ready, pickFile, openFile, say]);

  if (fatal) {
    return (
      <div className="hint" style={{ height: "100dvh" }}>
        <strong>{t("화면을 열지 못했습니다")}</strong>
        <span>{fatal}</span>
        <button type="button" className="btn" onClick={() => location.reload()}>{t("다시 불러오기")}</button>
      </div>
    );
  }
  if (!config || !ready || !doc) return <div className="hint" style={{ height: "100dvh" }}>{t("문서를 여는 중입니다")}</div>;

  const file: FileActions = { newDoc: newBlank, openFile: pickFile, myDocs: () => setShowDocs(true), example: openExample };

  return (
    <>
      <Workspace key={doc.id} stored={doc} temp={temp} config={config} onStored={onStored} file={file} />
      {showDocs && (
        <DocsDialog
          docs={docs}
          currentId={doc.id}
          onClose={() => setShowDocs(false)}
          onOpen={async (id) => {
            const next = await getDoc(id);
            setShowDocs(false);
            if (next) {
              setCurrentId(next.id);
              setTemp(false);
              setDoc(next);
            }
          }}
          onNew={newBlank}
          onImport={pickFile}
          onDelete={async (id) => {
            await deleteDoc(id);
            const rest = await listDocs();
            setDocs(rest);
            if (id === doc.id) {
              const next = rest.length ? await getDoc(rest[0].id) : null;
              if (next) {
                setCurrentId(next.id);
                setTemp(false);
                setDoc(next);
              } else {
                // 남은 문서가 없으면 새 문서를 연다
                setShowDocs(false);
                await open(blankDoc());
              }
            }
          }}
        />
      )}
      <input ref={mdInput} type="file" accept={MD_ACCEPT} hidden onChange={(e) => (e.target.files?.[0] && void openFile(e.target.files[0]), (e.target.value = ""))} />
      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <span>{t("놓으면 이 MD 파일을 새 문서로 엽니다")}</span>
        </div>
      )}
      {toast && (
        <div className="toast bad" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
