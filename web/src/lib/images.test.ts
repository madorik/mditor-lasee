import { describe, expect, it } from "vitest";
import { hostedName, imageSrc } from "./images";

const name = "0123456789abcdef0123456789abcdef-800x400.png";

describe("저장소에 올린 그림 주소", () => {
  it("서버(images.py)와 같은 꼴만 올린 그림으로 본다", () => {
    expect(hostedName(`https://lasee.watalabs.com/i/${name}`)).toBe(name);
    expect(hostedName(`/i/${name}`)).toBe(name);
    expect(hostedName(`http://localhost:8000/i/${name.replace(".png", ".jpg")}`)).toBe(name.replace(".png", ".jpg"));
    expect(hostedName("https://example.com/cat.png")).toBeNull();
    expect(hostedName("/i/../secret.png")).toBeNull();
    expect(hostedName("그림.png")).toBeNull();
  });

  it("화면에는 이 서버의 /i/ 로 그린다 — 다른 호스트로 요청하지 않는다", () => {
    expect(imageSrc(`https://elsewhere.example/i/${name}`, {})).toBe(`/i/${name}`);
    expect(imageSrc("data:image/png;base64,AAAA", {})).toBe("data:image/png;base64,AAAA");
    expect(imageSrc("그림.png", { "그림.png": { data: "data:x", w: 1, h: 1 } })).toBe("data:x");
    expect(imageSrc("https://example.com/cat.png", {})).toBeUndefined();
  });
});
