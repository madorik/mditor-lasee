// 문서를 주소의 # 뒤에 실어 주고받는다(서버로 가지 않는다). 서버 core.editor_link 와 같은 꼴:
// #md=<base64url(deflate-raw(utf-8))>

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function encodeLink(origin: string, md: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(md), new CompressionStream("deflate-raw"));
  let bin = "";
  packed.forEach((b) => (bin += String.fromCharCode(b)));
  return `${origin}/edit#md=${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

/** 주소에 문서가 실려 있으면 꺼낸다. 없거나 깨졌으면 null. */
export async function decodeHash(hash: string): Promise<string | null> {
  const m = hash.match(/[#&]md=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const bin = atob(m[1].replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
    return text.length <= 400_000 ? text : null;
  } catch {
    return null;
  }
}
