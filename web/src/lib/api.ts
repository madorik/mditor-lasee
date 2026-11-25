// 서버 호출. 미리보기류는 모두 저장하지 않는다.
// 모든 요청에 화면 언어(Accept-Language)를 실어 보낸다 — 서버가 알림 글과, 서식 태그가 아직 없는 문서의 태그 언어를 고른다.

import { lang, t } from "./i18n";
import type { Doc, Options, PageLayout, Preview } from "./types";

export type Config = {
  version: string;
  ai: boolean;
  aiMaxChars: number;
  maxChars: number;
  /** 한 번에 붙여 넣을 수 있는 글자 수 */
  maxPasteChars?: number;
  maxImageBytes: number;
  /** 그림을 저장소(R2)에 올린다. 아니면 문서와 함께 브라우저에 둔다. */
  images?: boolean;
  maxImageFileBytes?: number;
  maxUploadBytes?: number;
  /** 올린 그림을 두는 날 수(0 이면 지우지 않는다) */
  imageTtlDays?: number;
  publicUrl: string;
  contact: string;
  analytics?: boolean;
  ads: { client: string; content: string; editor: string };
};

declare global {
  interface Window {
    __MDITOR__?: Config;
    adsbygoogle?: unknown[];
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function fail(res: Response): Promise<never> {
  let message = t("요청에 실패했습니다({status}).", { status: res.status });
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    /* 본문이 JSON 이 아니다 */
  }
  throw new ApiError(message, res.status);
}

/**
 * 이 창(탭)의 열쇠 — 서버는 고치는 동안 저절로 가는 요청을 탭마다 줄 세워 가장 최근 것만 계산한다.
 * 같은 IP(회사 망 등)를 쓰는 다른 사람의 요청과 섞이지 않게 IP 대신 쓴다.
 */
const CLIENT = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
})();

/** 서버가 '더 새 요청이 있어 건너뛰었다'(409) · '큰 문서라 잠시 쉰다'(429) 고 답했는가 — 화면은 다음 요청에서 다시 받는다. */
export const isBusy = (e: unknown): boolean => e instanceof ApiError && (e.status === 409 || e.status === 429);

/**
 * 이보다 큰 요청은 gzip 으로 줄여 보낸다. 큰 문서의 미리보기 요청은 글에 기준 문서(JSON)까지 실려 수 MB 가 되는데,
 * 줄이면 보통 5~10배 작아진다(느린 업로드에서 멈출 때마다 몇 초씩 걸리던 것, 호스팅의 본문 한도에 닿던 것).
 */
const GZIP_OVER = 64 * 1024;
let gzipOk = typeof CompressionStream !== "undefined";

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** 줄여 보낸 본문을 서버까지 가는 길에서 풀지 못했는가 — 풀지 못한 본문(400), 압축을 모르는 곳(415), 압축 표시만 떼인 본문(JSON 이 깨져 검사 오류 목록이 온 422). */
async function unzipFailed(res: Response): Promise<boolean> {
  if (res.status === 400 || res.status === 415) return true;
  if (res.status !== 422) return false;
  try {
    return Array.isArray((await res.clone().json()).detail);
  } catch {
    return false;
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json", "Accept-Language": lang, "X-Mditor-Client": CLIENT };
  const send = async (payload: BodyInit, hs: Record<string, string>): Promise<Response> => {
    try {
      return await fetch(path, { method: "POST", headers: hs, body: payload, signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError(t("서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요."), 0);
    }
  };
  let packed: ArrayBuffer | null = null;
  if (gzipOk && json.length > GZIP_OVER) {
    try {
      packed = await gzip(json);
    } catch {
      gzipOk = false;
    }
  }
  let res = packed ? await send(packed, { ...headers, "Content-Encoding": "gzip" }) : await send(json, headers);
  if (packed && !res.ok && (await unzipFailed(res))) {
    gzipOk = false; // 이 창에서는 더 줄이지 않는다
    res = await send(json, headers);
  }
  return res.ok ? res : fail(res);
}

export async function loadConfig(): Promise<Config> {
  if (window.__MDITOR__) return window.__MDITOR__;
  const res = await fetch("/api/config", { headers: { "Accept-Language": lang } }); // 개발 서버(vite)에서는 HTML 에 설정이 박혀 있지 않다
  return res.ok ? res.json() : fail(res);
}

/** live: 고치는 동안 저절로 보내는 요청(서버가 더 새 요청이 오면 건너뛴다). 저장할 때는 쓰지 않는다. */
export async function preview(md: string, base: Doc | null, prev: Doc | null, signal?: AbortSignal, live = false): Promise<Preview> {
  return (await post("/api/md/preview", { md, base, prev, live }, signal)).json();
}

export type RenderInput = {
  md: string;
  base: Doc | null;
  options: Options;
  image_sizes?: Record<string, [number, number]>;
  images?: Record<string, string>;
  filename?: string;
  /** 고치는 동안 저절로 보내는 요청 */
  live?: boolean;
};

export async function pages(input: RenderInput, signal?: AbortSignal): Promise<PageLayout | null> {
  const body = await (await post("/api/md/preview-pages", input, signal)).json();
  return body.ok ? (body.layout as PageLayout) : null;
}

export async function pdf(input: RenderInput, download: boolean, signal?: AbortSignal): Promise<{ blob: Blob; pages: number }> {
  const res = await post(download ? "/api/md/pdf" : "/api/md/preview-pdf", input, signal);
  return { blob: await res.blob(), pages: Number(res.headers.get("X-Mditor-Pages") ?? 0) };
}

export type Uploaded = { url: string; name: string; w: number; h: number };

/** 그림 한 장을 저장소에 올린다(본문 = 줄인 그림 파일). */
export async function uploadImage(blob: Blob): Promise<Uploaded> {
  let res: Response;
  try {
    res = await fetch("/api/images", { method: "POST", headers: { "Content-Type": blob.type, "Accept-Language": lang }, body: blob });
  } catch {
    throw new ApiError(t("서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요."), 0);
  }
  return res.ok ? res.json() : fail(res);
}

export type Revision = {
  md: string;
  changed: boolean;
  sections: string[];
  new_numbers: string[];
  changes: { added: string[]; modified: string[]; removed: unknown[] } | null;
};

export async function revise(md: string, instruction: string, base: Doc | null): Promise<Revision> {
  return (await post("/api/md/revise", { md, instruction, base })).json();
}
