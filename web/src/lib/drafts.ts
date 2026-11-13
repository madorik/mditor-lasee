// 임시저장 — localStorage(키 = 문서). 모든 읽기·쓰기를 try/catch 로 감싼다(사생활 보호 창).
// 저장하거나 버리면 지운다.

export type Draft = { md: string; at: number; version: number };

const key = (docId: string) => `mditor:draft:${docId}`;

export function readDraft(docId: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(docId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return typeof d?.md === "string" && typeof d?.at === "number" ? { md: d.md, at: d.at, version: Number(d.version ?? 0) } : null;
  } catch {
    return null;
  }
}

export function writeDraft(docId: string, draft: Draft): void {
  try {
    localStorage.setItem(key(docId), JSON.stringify(draft));
  } catch {
    /* 꽉 찼거나 막혀 있다 — 임시저장 없이 간다 */
  }
}

export function clearDraft(docId: string): void {
  try {
    localStorage.removeItem(key(docId));
  } catch {
    /* 무시 */
  }
}
