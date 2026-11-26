import { describe, expect, it } from "vitest";
import { BANNERS, SIZES, isSafeSnippet, liveBanners, type Banner } from "./banners";

const SCRIPT = `<script src="https://ads-partners.coupang.com/g.js"></script><script>new PartnersCoupang.G({"id":1,"template":"carousel","trackingCode":"AF0000000","width":"680","height":"140","tsource":""});</script>`;
const IFRAME = `<iframe src="https://ads-partners.coupang.com/widgets.html?id=1&trackingCode=AF0000000" width="680" height="140" frameborder="0" scrolling="no" referrerpolicy="unsafe-url"></iframe>`;
const b = (slot: Banner["slot"], html: string, width = 680, height = 140): Banner => ({ slot, html, width, height });

describe("쿠팡 다이나믹 배너", () => {
  it("쿠팡 주소만 부르는 코드를 받는다(스크립트든 iframe 이든)", () => {
    expect(isSafeSnippet(SCRIPT)).toBe(true);
    expect(isSafeSnippet(IFRAME)).toBe(true);
  });

  it("비었거나 쿠팡이 아닌 곳을 부르는 코드는 받지 않는다", () => {
    expect(isSafeSnippet("")).toBe(false);
    expect(isSafeSnippet(`<script src="https://evil.example/x.js"></script>`)).toBe(false);
    expect(isSafeSnippet(`<script src="https://coupang.com.evil.example/g.js"></script>`)).toBe(false);
    expect(isSafeSnippet(`<script src="//evil.example/g.js"></script>`)).toBe(false);
    expect(isSafeSnippet(`${SCRIPT}<img src="https://evil.example/p.gif">`)).toBe(false);
  });

  it("자리와 크기가 맞는 배너만 그린다", () => {
    const list = [b("middle", SCRIPT), b("side", SCRIPT, 160, 600), b("bottom", ""), b("bottom", SCRIPT, 0, 140), b("middle", IFRAME)];
    expect(liveBanners("middle", list)).toHaveLength(2);
    expect(liveBanners("side", list)).toHaveLength(1);
    expect(liveBanners("bottom", list)).toHaveLength(0);
  });

  it("넣어 둔 배너는 모두 그릴 수 있는 것이고, 자리마다 크기가 파트너스에서 만든 값과 같다", () => {
    for (const x of BANNERS) {
      expect(liveBanners(x.slot, [x]), x.slot).toHaveLength(1);
      expect([x.width, x.height], x.slot).toEqual(SIZES[x.slot]);
      // 코드 안의 크기(width · height)도 설정과 같아야 쿠팡이 그 크기로 그린다
      expect(x.html, x.slot).toContain(`"width":"${x.width}","height":"${x.height}"`);
    }
    expect(Object.keys(SIZES).sort()).toEqual(["bottom", "export", "middle", "side"]);
  });

  it("쪽 안 가로 배너는 자리 폭에 맞춘다(300~1200px) — 코드의 폭만 바꾸고 쿠팡 주소만 부르는 것은 그대로다", async () => {
    const { fitWidth, withWidth, isSafeSnippet: safe } = await import("./banners");
    expect([fitWidth(1124.6), fitWidth(2000), fitWidth(180), fitWidth(0)]).toEqual([1125, 1200, 300, 300]);
    const code = `<script src="https://ads-partners.coupang.com/g.js"></script>\n<script>\n\tnew PartnersCoupang.G({"id":1,"template":"carousel","trackingCode":"AF1","width":"680","height":"140","tsource":""});\n</script>`;
    const wide = withWidth(code, 1125);
    expect(wide).toContain('"width":"1125","height":"140"');
    expect(wide.replace('"width":"1125"', '"width":"680"')).toBe(code);
    expect(safe(wide)).toBe(true);
  });
});
