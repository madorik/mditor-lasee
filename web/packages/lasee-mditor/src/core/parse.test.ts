import { describe, expect, it } from "vitest";
import { canon, normalize, segments, write, type Seg } from "./inline";
import { parseMarkdown } from "./parse";
import { docToMarkdown } from "./write";

const md = (src: string, dialect?: "ko" | "en") => docToMarkdown(parseMarkdown(src, dialect));

const SAMPLE = `# 새 문법 모음

## 1. 글 서식

[링크 **굵은** 글](https://example.com/a_(b)) · \`코드 \` 백틱\` · ==형광펜== · H<sub>2</sub>O · x<sup>2</sup>

{가운데}가운데 정렬 문단{/가운데}

{오른쪽}**오른쪽** 정렬{/오른쪽}

## 2. 목록

1. 하나
2. 둘
   - 둘 아래 글머리
     1. 더 아래 번호
3. 셋
- [ ] 할 일
- [x] 끝낸 일

7. 일곱부터
8. 여덟

## 3. 코드 · 가로줄 · 쪽 나눔

\`\`\`py
def f():
    # 섹션 머리가 아니다
    return "\`\`\`"
\`\`\`
> 코드 아래 비고

---

<!-- pagebreak -->
`;

describe("새 문법 — 읽고 다시 쓰기", () => {
  it("한 번 다듬은 MD 는 다시 읽어 써도 같다", () => {
    const once = md(SAMPLE);
    expect(md(once)).toBe(once);
  });

  it("번호 목록 · 할 일 · 들여쓰기", () => {
    const doc = parseMarkdown(SAMPLE);
    const list = doc.sections[1].blocks[0];
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.items).toEqual([
      { text: "하나", level: 0, ordered: true },
      { text: "둘", level: 0, ordered: true },
      { text: "둘 아래 글머리", level: 1 },
      { text: "더 아래 번호", level: 2, ordered: true },
      { text: "셋", level: 0, ordered: true },
      { text: "할 일", level: 0, checked: false },
      { text: "끝낸 일", level: 0, checked: true },
      { text: "일곱부터", level: 0, ordered: true, start: 7 },
      { text: "여덟", level: 0, ordered: true },
    ]);
    expect(md(SAMPLE)).toContain("1. 하나\n2. 둘\n   - 둘 아래 글머리\n     1. 더 아래 번호\n3. 셋\n- [ ] 할 일\n- [x] 끝낸 일\n7. 일곱부터\n8. 여덟");
  });

  it("코드 블록 안의 # 은 섹션이 아니고, 울타리는 코드 속 백틱보다 길다", () => {
    const doc = parseMarkdown(SAMPLE);
    expect(doc.sections.map((s) => s.title)).toEqual(["1. 글 서식", "2. 목록", "3. 코드 · 가로줄 · 쪽 나눔"]);
    const code = doc.sections[2].blocks[0];
    expect(code).toMatchObject({ kind: "code", lang: "py", notes: ["코드 아래 비고"] });
    expect(md(SAMPLE)).toContain('````py\ndef f():\n    # 섹션 머리가 아니다\n    return "```"\n````\n> 코드 아래 비고');
    expect(doc.sections[2].blocks.map((b) => b.kind)).toEqual(["code", "rule", "pagebreak"]);
  });

  it("문단 정렬 — 문서의 태그 언어로 쓴다", () => {
    const doc = parseMarkdown(SAMPLE);
    expect(doc.sections[0].blocks.slice(1).map((b) => (b.kind === "text" ? [b.text, b.align] : null))).toEqual([
      ["가운데 정렬 문단", "center"],
      ["**오른쪽** 정렬", "right"],
    ]);
    expect(md("{center}x{/center}\n")).toBe("{center}x{/center}\n");
    expect(md("{가운데}x{/가운데}\n", "en")).toBe("{가운데}x{/가운데}\n");
    expect(md("{왼쪽}x{/왼쪽}\n")).toBe("x\n");
    expect(md("a {가운데}b{/가운데}\n")).toBe("a b\n"); // 문단 일부의 정렬 태그는 버린다
  });

  it("블록 기호로 읽힐 문단은 이스케이프한다", () => {
    for (const para of ["1. 개요", "2026) 연도", "<!-- pagebreak -->", "___", "{가운데}글자{/가운데}"]) {
      const doc = { title: "", sections: [{ key: "s", title: "", blocks: [{ id: "b", kind: "text" as const, title: null, text: canon(para.replace(/[{}]/g, "\\$&"), "para"), notes: [] }] }] };
      const out = docToMarkdown(doc);
      const again = parseMarkdown(out);
      expect(again.sections[0].blocks[0], out).toMatchObject({ kind: "text" });
      expect(docToMarkdown(again), out).toBe(out);
    }
    expect(canon("1. 개요", "para")).toBe("1\\. 개요");
    expect(canon("[ ] 칸", "item")).toBe("\\[ ] 칸");
  });
});

describe("새 글 서식 — 표준 꼴", () => {
  it("링크", () => {
    expect(segments("[a **b**](u) c")).toEqual([{ text: "a ", link: "u" }, { text: "b", link: "u", bold: true }, { text: " c" }]);
    expect(canon("**a [b](u) c**")).toBe("**a** [**b**](u) **c**");
    expect(canon("[a [b] c](u)")).toBe("[a \\[b\\] c](u)");
    expect(canon("[x](a b)")).toBe("[x](a b)"); // 빈칸이 든 주소는 링크가 아니다
    expect(write([{ text: "x", link: "a b(c" }])).toBe("[x](a%20b%28c)");
    expect(canon("\\[a](u)")).toBe("\\[a](u)");
    expect(segments("[a [b](u) c](v)").filter((s) => s.link).map((s) => [s.text, s.link])).toEqual([["b", "u"]]);
  });

  it("코드", () => {
    expect(segments("a `b **c**` d")).toEqual([{ text: "a " }, { text: "b **c**", code: true }, { text: " d" }]);
    expect(canon("` `` `")).toBe("` `` `");
    expect(write([{ text: "a`b", code: true }])).toBe("``a`b``");
    expect(write([{ text: "`x", code: true }])).toBe("`` `x ``");
    expect(write([{ text: "a`b" }])).toBe("a\\`b");
    expect(canon("**`x`**")).toBe("**`x`**");
    // 짝 없는 ](…) 안의 백틱 · 백슬래시 — 쓸 때마다 백슬래시가 불어나지 않는다
    for (const s of ["](`)", "](\\*)", "a](b\\`c)"]) expect(canon(canon(s)), s).toBe(canon(s));
  });

  it("형광펜 · 첨자", () => {
    expect(segments("==a== b")).toEqual([{ text: "a", mark: true }, { text: " b" }]);
    expect(canon("== a ==")).toBe("== a ==");
    expect(write(normalize([{ text: " a ", mark: true }]))).toBe("==a==");
    expect(segments("H<sub>2</sub>O")).toEqual([{ text: "H" }, { text: "2", script: "sub" }, { text: "O" }]);
    expect(write([{ text: "<sup>" }])).toBe("\\<sup>");
  });

  it("무작위 조각 — 쓰고 다시 읽어도 같다", () => {
    let seed = 20261125;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const alphabet = ["가", " ", "*", "~", "=", "`", "[", "]", "](", "](a", "(", ")", "{", "}", "\\", "<", "sup>", "br>", "1.", "a", "|", "-", "#", "_", "{가운데}"];
    for (let n = 0; n < 600; n++) {
      const segs: Seg[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
        text: Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => pick(alphabet)).join(""),
        link: rnd() < 0.2 ? pick(["u", "https://x.y/(a)", "a b"]) : null,
        bold: rnd() < 0.3,
        strike: rnd() < 0.2,
        italic: rnd() < 0.2,
        mark: rnd() < 0.2,
        color: rnd() < 0.2 ? "빨강" : null,
        script: rnd() < 0.1 ? "sup" : null,
        code: rnd() < 0.15,
      }));
      const norm = normalize(segs);
      for (const ctx of [null, "cell", "para", "item"] as const) {
        const s = write(norm, ctx);
        const back = normalize(segments(s));
        expect(write(back, ctx), JSON.stringify(segs)).toBe(s);
      }
    }
  });
});
