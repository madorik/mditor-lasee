import { createMDitor, type MDitor } from "../src/index";
import "../src/style.css";

const SAMPLE = `# 편집기 데모

## 1. 글 서식

**굵게** {기울임}기울임{/기울임} {밑줄}밑줄{/밑줄} ~~취소선~~ ==형광펜== {음영}음영{/음영} {빨강}빨강{/빨강} {#2e8b57}초록{/#2e8b57}
[링크](https://lasee.watalabs.com) · \`인라인 코드\` · H<sub>2</sub>O · x<sup>2</sup>

{가운데}가운데 정렬 문단{/가운데}

## 2. 목록

1. 첫째
2. 둘째
   - 글머리 하위
3. 셋째
- [x] 끝낸 일
- [ ] 할 일

## 3. 표

| 구분 | 합친 머리 | < |
| ^ | 왼쪽 | 오른쪽 |
|:---|:---|---:|
| 가 | 1 | {음영}2{/음영} |
> 표 아래 비고

## 4. 코드 · 가로줄 · 쪽 나눔

\`\`\`ts
const mditor = createMDitor({ element, markdown });
\`\`\`

---

<!-- pagebreak -->

마지막 쪽.
`;

const out = document.querySelector<HTMLPreElement>("#out")!;
const host = document.querySelector<HTMLDivElement>("#mditor")!;
let locale: "ko" | "en" = "ko";
let editable = true;
let ed: MDitor;

function mount(markdown: string) {
  ed?.destroy();
  ed = createMDitor({ element: host, markdown, locale, preview: true, placeholder: locale === "ko" ? "여기에 쓰세요" : "Start writing", onChange: (md) => (out.textContent = md) });
  out.textContent = ed.getMarkdown();
  (window as unknown as { mditor: MDitor }).mditor = ed;
}

mount(SAMPLE);
document.querySelector("#lang")!.addEventListener("click", (e) => {
  locale = locale === "ko" ? "en" : "ko";
  (e.target as HTMLButtonElement).textContent = locale === "ko" ? "English" : "한국어";
  mount(ed.getMarkdown());
});
document.querySelector("#ro")!.addEventListener("click", () => {
  editable = !editable;
  ed.setEditable(editable);
});
document.querySelector("#dump")!.addEventListener("click", () => ed.setMarkdown(ed.getMarkdown()));
