import { describe, expect, it } from "vitest";
import { insertBlockLine, insertCodeBlock, insertLink, prefixLines, type Edit } from "./mdedit";

const apply = (text: string, e: Edit) => text.slice(0, e.start) + e.text + text.slice(e.end);

describe("MD 탭 도구", () => {
  it("줄 앞 기호 — 다른 목록 기호는 바꾸고, 같은 기호면 뗀다", () => {
    expect(apply("- 가\n- 나", prefixLines("- 가\n- 나", 0, 6, "1. "))).toBe("1. 가\n1. 나");
    expect(apply("1. 가", prefixLines("1. 가", 0, 0, "- [ ] "))).toBe("- [ ] 가");
    expect(apply("- [x] 가", prefixLines("- [x] 가", 0, 0, "1. "))).toBe("1. 가");
    expect(apply("1. 가", prefixLines("1. 가", 0, 0, "1. "))).toBe("가");
  });

  it("링크 — 고른 글을 감싸고 주소 자리를 고른다", () => {
    const e = insertLink("보기 글", 3, 4, "링크");
    expect(apply("보기 글", e)).toBe("보기 [글](https://)");
    expect(apply("보기 글", e).slice(e.selStart, e.selEnd)).toBe("https://");
    expect(apply("", insertLink("", 0, 0, "링크"))).toBe("[링크](https://)");
  });

  it("코드 블록 — 고른 줄을 감싸거나 빈 블록을 넣는다", () => {
    expect(apply("a\nb\nc", insertCodeBlock("a\nb\nc", 2, 3))).toBe("a\n```\nb\n```\nc");
    const e = insertCodeBlock("a", 1, 1);
    expect(apply("a", e)).toBe("a\n\n```\n\n```");
    expect(apply("a", e).slice(0, e.selStart)).toBe("a\n\n```\n");
  });

  it("가로줄 · 쪽 나눔은 지금 줄 아래에", () => {
    expect(apply("가\n나", insertBlockLine("가\n나", 0, "<!-- pagebreak -->"))).toBe("가\n\n<!-- pagebreak -->\n\n나");
  });
});
