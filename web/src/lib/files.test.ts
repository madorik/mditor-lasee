import { describe, expect, it } from "vitest";
import { decodeText, isMdFile, readMdFile, stemOf } from "./files";

const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe("MD 파일 읽기", () => {
  it("UTF-8 은 그대로, 앞의 BOM 은 떼고, 줄바꿈은 \\n 으로", () => {
    const utf8 = new TextEncoder().encode("﻿# 제목\r\n\r\n- 항목\r\n");
    expect(decodeText(utf8.buffer as ArrayBuffer)).toBe("# 제목\n\n- 항목\n");
  });

  it("UTF-8 이 아니면 EUC-KR 로 읽는다", () => {
    // "# 가나다" 를 EUC-KR 로
    expect(decodeText(bytes(0x23, 0x20, 0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9))).toBe("# 가나다");
  });

  it("파일 이름 → 문서 이름", () => {
    expect(stemOf("3분기 보고.md")).toBe("3분기 보고");
    expect(stemOf("report.final.markdown")).toBe("report.final");
    expect(stemOf(".md")).toBe("이름 없는 문서");
  });

  it("MD 가 아닌 파일과 너무 큰 파일은 열지 않는다", async () => {
    expect(isMdFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(false);
    expect(isMdFile(new File(["x"], "a.MD"))).toBe(true);
    await expect(readMdFile(new File(["x"], "a.png", { type: "image/png" }), 100)).rejects.toThrow("MD 파일");
    await expect(readMdFile(new File(["가".repeat(30)], "a.md"), 20)).rejects.toThrow("너무 큽니다");
    await expect(readMdFile(new File(["# 제목\n"], "a.md"), 20)).resolves.toBe("# 제목\n");
  });
});
