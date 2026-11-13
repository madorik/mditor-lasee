// 서버 호출. 미리보기류는 모두 저장하지 않는다.

import type { Doc, Options, PageLayout, Preview } from "./types";

export type Config = {
  version: string;
  ai: boolean;
  aiMaxChars: number;
  maxChars: number;
  maxImageBytes: number;
  publicUrl: string;
  contact: string;
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
  let message = `요청에 실패했습니다(${res.status}).`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    /* 본문이 JSON 이 아니다 */
  }
  throw new ApiError(message, res.status);
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.", 0);
  }
  return res.ok ? res : fail(res);
}

export async function loadConfig(): Promise<Config> {
  if (window.__MDITOR__) return window.__MDITOR__;
  const res = await fetch("/api/config"); // 개발 서버(vite)에서는 HTML 에 설정이 박혀 있지 않다
  return res.ok ? res.json() : fail(res);
}

export async function preview(md: string, base: Doc | null, prev: Doc | null, signal?: AbortSignal): Promise<Preview> {
  return (await post("/api/md/preview", { md, base, prev }, signal)).json();
}

export type RenderInput = {
  md: string;
  base: Doc | null;
  options: Options;
  image_sizes?: Record<string, [number, number]>;
  images?: Record<string, string>;
  filename?: string;
};

export async function pages(input: RenderInput, signal?: AbortSignal): Promise<PageLayout | null> {
  const body = await (await post("/api/md/preview-pages", input, signal)).json();
  return body.ok ? (body.layout as PageLayout) : null;
}

export async function pdf(input: RenderInput, download: boolean, signal?: AbortSignal): Promise<{ blob: Blob; pages: number }> {
  const res = await post(download ? "/api/md/pdf" : "/api/md/preview-pdf", input, signal);
  return { blob: await res.blob(), pages: Number(res.headers.get("X-Mditor-Pages") ?? 0) };
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
