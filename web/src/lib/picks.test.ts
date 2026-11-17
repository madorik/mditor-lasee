import { describe, expect, it } from "vitest";
import { DISCLOSURE, PICKS, livePicks, pickImage, type Pick } from "./picks";

const pick = (id: string, url: string, image = ""): Pick => ({ id, icon: "laptop", title: id, blurb: "", search: id, url, image });

describe("쿠팡 파트너스 추천 칸", () => {
  it("파트너스 주소가 든 칸만 그린다", () => {
    const list = [
      pick("ok", "https://link.coupang.com/a/iIEsiinAXI"),
      pick("empty", ""),
      pick("search", "https://www.coupang.com/np/search?q=모니터"), // 파트너스 링크가 아니라 수수료가 안 붙는다
      pick("http", "http://link.coupang.com/a/abc"),
      pick("trick", "https://link.coupang.com.evil.example/a/abc"),
      pick("script", "javascript:alert(1)"),
    ];
    expect(livePicks(list).map((p) => p.id)).toEqual(["ok"]);
  });

  it("넣어 둔 목록은 id 가 겹치지 않고, 주소는 비었거나 파트너스 주소다(오타를 막는다)", () => {
    expect(new Set(PICKS.map((p) => p.id)).size).toBe(PICKS.length);
    for (const p of PICKS) expect(p.url === "" || livePicks([p]).length === 1, p.id).toBe(true);
  });

  it("사진은 쿠팡 사진 주소(https, coupangcdn.com)만 받고 나머지는 아이콘으로 둔다", () => {
    const ok = "https://thumbnail5.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/9bcc/08b7.jpg";
    expect(pickImage(pick("a", "", ok))).toBe(ok);
    for (const bad of ["", "http://t2a.coupangcdn.com/a.jpg", "https://coupangcdn.com.evil.example/a.jpg", "https://evil.example/coupangcdn.com/a.jpg", "javascript:alert(1)", 'https://t2a.coupangcdn.com/a.jpg" onerror="x']) {
      expect(pickImage(pick("b", "", bad)), bad).toBe("");
    }
  });

  it("고지 문구에 쿠팡 파트너스와 수수료가 나온다", () => {
    expect(DISCLOSURE).toContain("쿠팡 파트너스");
    expect(DISCLOSURE).toContain("수수료");
  });
});
