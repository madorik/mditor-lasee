import { useCallback, useEffect, useRef, useState } from "react";
import example from "../../../src/mditor/data/example.md?raw";
import * as api from "../lib/api";
import { decodeHash } from "../lib/share";
import { currentId, deleteDoc, getDoc, listDocs, newDoc, putDoc, setCurrentId, type DocSummary, type StoredDoc } from "../lib/store";
import { DocsDialog } from "./Dialogs";
import { Workspace } from "./Workspace";

const BLANK = "# 제목 없는 문서\n\n## 1. 개요\n\n- 여기에 내용을 적으세요.\n";

function titleOf(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m ? m[1].trim() : fallback).slice(0, 80);
}

export function App() {
  const [config, setConfig] = useState<api.Config | null>(null);
  const [doc, setDoc] = useState<StoredDoc | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [showDocs, setShowDocs] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const mdInput = useRef<HTMLInputElement>(null);

  const open = useCallback(async (next: StoredDoc) => {
    await putDoc(next);
    setCurrentId(next.id);
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
          return await open(newDoc(titleOf(shared, "받은 문서"), shared));
        }
        // 2) 지난번에 열어 둔 문서
        const id = currentId();
        const last = id ? await getDoc(id) : null;
        if (last) {
          setDoc(last);
          setDocs(await listDocs());
          return;
        }
        // 3) 가장 최근 문서, 없으면 예시 문서
        const all = await listDocs();
        const recent = all.length ? await getDoc(all[0].id) : null;
        await open(recent ?? newDoc(titleOf(example, "예시 문서"), example));
      } catch (e) {
        if (alive) setFatal(e instanceof Error ? e.message : "화면을 열지 못했습니다.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const onStored = useCallback((next: StoredDoc) => {
    setDoc(next);
    setDocs((list) => [{ id: next.id, name: next.name, updatedAt: next.updatedAt }, ...list.filter((d) => d.id !== next.id)]);
  }, []);

  const importMd = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setShowDocs(false);
    await open(newDoc(titleOf(text, file.name.replace(/\.[^.]*$/, "")), text));
  };

  if (fatal) {
    return (
      <div className="hint" style={{ height: "100dvh" }}>
        <strong>화면을 열지 못했습니다</strong>
        <span>{fatal}</span>
        <button type="button" className="btn" onClick={() => location.reload()}>다시 불러오기</button>
      </div>
    );
  }
  if (!config || !doc) return <div className="hint" style={{ height: "100dvh" }}>문서를 여는 중입니다</div>;

  return (
    <>
      <Workspace key={doc.id} stored={doc} config={config} onStored={onStored} onOpenDocs={() => setShowDocs(true)} />
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
              setDoc(next);
            }
          }}
          onNew={() => (setShowDocs(false), void open(newDoc("제목 없는 문서", BLANK)))}
          onImport={() => mdInput.current?.click()}
          onDelete={async (id) => {
            await deleteDoc(id);
            const rest = await listDocs();
            setDocs(rest);
            if (id === doc.id) {
              const next = rest.length ? await getDoc(rest[0].id) : null;
              await open(next ?? newDoc("제목 없는 문서", BLANK));
            }
          }}
        />
      )}
      <input ref={mdInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => (void importMd(e.target.files?.[0]), (e.target.value = ""))} />
    </>
  );
}
