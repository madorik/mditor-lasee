// 내 컴퓨터의 MD 파일 읽기. UTF-8 로 읽고, 아니면 한글 윈도우에서 흔한 EUC-KR(CP949)로 읽는다.

import { t } from "./i18n";

export const MD_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";

export function isMdFile(file: File): boolean {
  return /\.(md|markdown|txt)$/i.test(file.name) || file.type === "text/markdown" || file.type === "text/plain";
}

/** 파일 이름에서 확장자를 뺀 것 — 새 문서의 이름이 된다. */
export function stemOf(name: string): string {
  return name.replace(/\.[^.]*$/, "").trim() || t("이름 없는 문서");
}

export function decodeText(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); // 앞의 BOM 은 떼어 낸다
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.replace(/\r\n?/g, "\n");
}

export async function readMdFile(file: File, maxChars: number): Promise<string> {
  if (!isMdFile(file)) throw new Error(t("MD 파일(.md)만 열 수 있습니다."));
  // 한 글자는 UTF-8 로 4바이트를 넘지 않는다 — 읽기 전에 너무 큰 파일을 거른다
  if (file.size > maxChars * 4) throw new Error(t("파일이 너무 큽니다. {max}자까지 열 수 있습니다.", { max: maxChars.toLocaleString() }));
  const text = decodeText(await file.arrayBuffer());
  if (text.length > maxChars) throw new Error(t("파일이 너무 큽니다. {max}자까지 열 수 있습니다.", { max: maxChars.toLocaleString() }));
  return text;
}
