// 그림 넣기 — 큰 그림은 긴 변 1600px 로 줄인다.
// 그림 저장소(R2)가 켜져 있으면 줄인 그림을 서버에 올리고 문서에는 그 주소를 쓴다(prepareImage → api.uploadImage).
// 꺼져 있으면 예전처럼 문서와 함께 브라우저에 둔다(readImage).

import { t } from "./i18n";
import type { StoredImage } from "./store";

const MAX_SIDE = 1600;
export const DEFAULT_MAX_FILE_BYTES = 10_000_000;

// 저장소에 올린 그림 주소 — …/i/<해시32자>-<가로>x<세로>.png|jpg. 서버 images.py 의 _SRC 와 같은 꼴이다.
const HOSTED = /^(?:https?:\/\/[^/\s]+)?\/i\/([0-9a-f]{32}-\d{1,5}x\d{1,5}\.(?:png|jpg))$/;

/** 저장소에 올린 그림이면 그 이름. */
export function hostedName(src: string): string | null {
  return HOSTED.exec(src.trim())?.[1] ?? null;
}

/**
 * 화면에 그릴 그림 주소. 올린 그림은 이 서버의 /i/ 로 그린다 — 주소의 호스트가 달라도(다른 곳에서 내려받은 MD)
 * 바깥으로 요청하지 않고, PDF(서버가 이름으로 꺼낸다)와 같은 그림이 보인다.
 */
export function imageSrc(src: string, images: Record<string, StoredImage>): string | undefined {
  if (src.startsWith("data:")) return src;
  const name = hostedName(src);
  if (name) return `/i/${name}`;
  return images[src]?.data;
}

const mb = (n: number) => String(Math.round((n / 1_000_000) * 10) / 10);

type Drawn = { canvas: HTMLCanvasElement; w: number; h: number; photo: boolean };

/** 파일을 읽어 긴 변 1600px 이하로 그린다. 그림이 아니거나 파일이 너무 크면 알린다. */
async function draw(file: File, maxFileBytes: number): Promise<Drawn> {
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) throw new Error(t("PNG · JPEG · GIF · WebP 그림만 붙일 수 있습니다."));
  if (file.size > maxFileBytes) throw new Error(t("그림 파일이 너무 큽니다({size}MB). 한 장에 {mb}MB 까지 넣을 수 있습니다.", { size: mb(file.size), mb: mb(maxFileBytes) }));
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
    if (!ctx) throw new Error();
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, w, h, photo: file.type === "image/jpeg" };
  } catch {
    throw new Error(t("그림을 읽지 못했습니다.")); // 그림이 깨졌거나 그리지 못했다
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("그림을 읽지 못했습니다.")))), type, quality));

/** 흰 바탕에 얹은 사본 — 투명한 PNG 를 JPEG 로 바꿀 때 투명한 곳이 검게 나오지 않게. */
function onWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

export type Prepared = { blob: Blob; w: number; h: number };

/** 저장소에 올릴 그림. 사진은 JPEG, 나머지는 PNG — PNG 가 한도를 넘으면(사진을 PNG 로 저장한 것 등) JPEG 로 줄인다. */
export async function prepareImage(file: File, maxFileBytes: number, maxBytes: number): Promise<Prepared> {
  const { canvas, w, h, photo } = await draw(file, maxFileBytes);
  let blob = await toBlob(canvas, photo ? "image/jpeg" : "image/png", 0.9);
  if (blob.size > maxBytes && !photo) blob = await toBlob(onWhite(canvas), "image/jpeg", 0.88);
  if (blob.size > maxBytes) throw new Error(t("그림이 너무 큽니다. 줄여도 {mb}MB 를 넘습니다.", { mb: mb(maxBytes) }));
  return { blob, w, h };
}

/** 저장소가 꺼져 있을 때 — 문서와 함께 브라우저에 둘 그림(data URI). */
export async function readImage(file: File, maxFileBytes: number): Promise<StoredImage> {
  const { canvas, w, h, photo } = await draw(file, maxFileBytes);
  return { data: canvas.toDataURL(photo ? "image/jpeg" : "image/png", 0.9), w, h };
}

/** 문서 안에서 겹치지 않는 그림 이름(브라우저에 둘 때). */
export function imageName(file: File, taken: Record<string, unknown>): string {
  const ext = file.type === "image/jpeg" ? "jpg" : "png";
  const stem = file.name.replace(/\.[^.]*$/, "").replace(/[()[\]|\\\s]+/g, "-").replace(/^-+|-+$/g, "") || t("그림");
  let name = `${stem}.${ext}`;
  for (let n = 2; name in taken; n++) name = `${stem}-${n}.${ext}`;
  return name;
}
