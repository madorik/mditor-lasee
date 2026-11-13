// 문서 보관 — 사용자의 브라우저(IndexedDB)에만 둔다. 서버에는 문서를 저장하지 않는다.
// IndexedDB 를 못 쓰는 환경(사생활 보호 창 등)에서는 메모리에만 두고 그 사실을 알린다.

import { DEFAULT_OPTIONS, type Doc, type Options } from "./types";

export type StoredImage = { data: string; w: number; h: number };
export type Version = { n: number; at: number; md: string };

export type StoredDoc = {
  id: string;
  name: string;
  md: string;
  /** 저장할 때 서버가 되읽은 문서 — 변경 표시와 id 잇기의 기준 */
  base: Doc | null;
  options: Options;
  images: Record<string, StoredImage>;
  versions: Version[];
  createdAt: number;
  updatedAt: number;
};

export type DocSummary = Pick<StoredDoc, "id" | "name" | "updatedAt">;

const DB = "mditor";
const STORE = "docs";
const MAX_VERSIONS = 50;
const memory = new Map<string, StoredDoc>();
let persistent = true;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

async function safe<T>(run: () => Promise<T>, fallback: () => T): Promise<T> {
  if (!persistent) return fallback();
  try {
    return await run();
  } catch {
    persistent = false; // 이 뒤로는 메모리만 쓴다
    return fallback();
  }
}

/** 문서가 이 브라우저에 남는지(false 면 창을 닫으면 사라진다). */
export const isPersistent = () => persistent;

export async function listDocs(): Promise<DocSummary[]> {
  const all = await safe(
    () => tx<StoredDoc[]>("readonly", (s) => s.getAll()),
    () => [...memory.values()],
  );
  return all.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id: string): Promise<StoredDoc | null> {
  const doc = await safe(
    () => tx<StoredDoc | undefined>("readonly", (s) => s.get(id)),
    () => memory.get(id),
  );
  return doc ? { ...doc, options: { ...DEFAULT_OPTIONS, ...doc.options }, images: doc.images ?? {}, versions: doc.versions ?? [] } : null;
}

export async function putDoc(doc: StoredDoc): Promise<void> {
  memory.set(doc.id, doc);
  await safe(
    () => tx("readwrite", (s) => s.put(doc)).then(() => undefined),
    () => undefined,
  );
}

export async function deleteDoc(id: string): Promise<void> {
  memory.delete(id);
  await safe(
    () => tx("readwrite", (s) => s.delete(id)).then(() => undefined),
    () => undefined,
  );
}

export function newDoc(name: string, md: string): StoredDoc {
  const now = Date.now();
  const id = `d${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, md, base: null, options: { ...DEFAULT_OPTIONS }, images: {}, versions: [], createdAt: now, updatedAt: now };
}

/** 저장 = 새 판본. 지난 판본으로 되돌리는 것도 새 판본이다(그 사이 판본은 이력에 남는다). */
export function withVersion(doc: StoredDoc, md: string, base: Doc): StoredDoc {
  const last = doc.versions[doc.versions.length - 1];
  const n = (last?.n ?? 0) + 1;
  const versions = [...doc.versions, { n, at: Date.now(), md }].slice(-MAX_VERSIONS);
  return { ...doc, md, base, versions, updatedAt: Date.now() };
}

// 지금 열어 둔 문서 — 다시 왔을 때 이어서 연다
const CURRENT = "mditor:current";

export function currentId(): string | null {
  try {
    return localStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

export function setCurrentId(id: string): void {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {
    /* 사생활 보호 창 */
  }
}
