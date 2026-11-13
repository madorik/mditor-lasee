// 그림 붙이기 — 큰 그림은 줄여서 문서와 함께 브라우저에 둔다.

import type { StoredImage } from "./store";

const MAX_SIDE = 1600;

export async function readImage(file: File): Promise<StoredImage> {
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) throw new Error("PNG · JPEG · GIF · WebP 그림만 붙일 수 있습니다.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("그림을 읽지 못했습니다.");
    ctx.drawImage(img, 0, 0, w, h);
    const photo = file.type === "image/jpeg";
    return { data: canvas.toDataURL(photo ? "image/jpeg" : "image/png", 0.9), w, h };
  } catch (e) {
    throw e instanceof Error && e.message.includes("그림") ? e : new Error("그림을 읽지 못했습니다.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 문서 안에서 겹치지 않는 그림 이름. */
export function imageName(file: File, taken: Record<string, unknown>): string {
  const ext = file.type === "image/jpeg" ? "jpg" : "png";
  const stem = file.name.replace(/\.[^.]*$/, "").replace(/[()[\]|\\\s]+/g, "-").replace(/^-+|-+$/g, "") || "그림";
  let name = `${stem}.${ext}`;
  for (let n = 2; name in taken; n++) name = `${stem}-${n}.${ext}`;
  return name;
}
