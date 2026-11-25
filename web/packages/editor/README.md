# @mditor/editor

보이는 모양 그대로 고치고, 원본은 **Markdown** 으로 남기는 문서 편집기.
[MDitor LaSee](https://lasee.watalabs.com) 의 편집기를 떼어 낸 라이브러리다. 서버 없이 브라우저에서 돈다.

> A WYSIWYG Markdown editor: edit what you see, keep Markdown as the source of truth. Framework-free core, optional React wrapper, `<script>` bundle. Korean/English UI.

- **도구 막대** — 되돌리기 · 블록 종류(본문 · 큰 제목 · 작은 제목 · 목록 · 비고 · 코드 블록 · 문서 제목) · 굵게 · 기울임 · 밑줄 · 취소선 · 글자 색(팔레트 · 색 코드) · 음영 · 형광펜 · 링크 · 인라인 코드 · 위/아래 첨자 · 서식 지우기 · 글머리/번호/할 일 목록 · 들여쓰기 · 문단 정렬 · 표(크기 고르기) · 이미지(주소 · 파일 · 붙여넣기 · 끌어다 놓기) · 코드 블록 · 가로줄 · 쪽 나눔 · 특수 문자 · 찾아 바꾸기 · MD 원문 · 미리보기 켜고 끄기 · 전체 화면
- **표** — 행 · 열 넣기/지우기, 칸 합치기 · 나누기, 칸 음영, 열 정렬 (표 안에 커서가 있으면 표 도구가 나온다)
- **입력 규칙** — `- ` 글머리, `1. ` 번호, `[ ] ` 할 일, `## ` `### ` 제목, `> ` 비고, ```` ``` ```` 코드 블록, `---` 가로줄, `**굵게**` `==형광펜==` `` `코드` ``
- **MD 붙여넣기** — Markdown 글을 붙이면 문서로 읽어 넣는다(Shift 붙여넣기는 글 그대로). 워드 · 구글 문서에서 붙인 표 · 목록 · 링크도 받는다.
- **글자 수** · **읽기 전용** · **ko / en 화면 글**(바꿔 쓸 수 있다)
- 출력 MD 는 언제나 하나의 표준 꼴이다(같은 문서는 같은 MD). MDitor 서버(PDF)와 바이트 단위로 같은 규칙을 쓴다.

## 설치

```bash
npm install @mditor/editor
```

> 지금은 저장소 안(`web/packages/editor`)에서만 쓴다. npm 에 내는 법은 아래 ‘묶기 · 내기’.

## 쓰기

### 프레임워크 없이(ESM)

```ts
import { createEditor } from "@mditor/editor";
import "@mditor/editor/style.css";

const editor = createEditor({
  element: document.querySelector("#editor")!,
  markdown: "# 제목\n\n본문\n",
  locale: "ko",          // 화면 글: "ko" | "en"
  preview: true,         // 미리보기 창을 열어 둔다(도구 막대에서 켜고 끈다)
  onChange: (md) => console.log(md),
});

editor.getMarkdown();
editor.setMarkdown("## 새 글\n");
```

### `<script>` 하나로(UMD)

```html
<link rel="stylesheet" href="https://unpkg.com/@mditor/editor/dist/style.css" />
<script src="https://unpkg.com/@mditor/editor/dist/mditor-editor.umd.js"></script>
<div id="editor" style="height: 600px"></div>
<script>
  const editor = MDitorEditor.createEditor({ element: document.getElementById("editor"), markdown: "# 안녕\n" });
</script>
```

### React

```tsx
import { MarkdownEditorView } from "@mditor/editor/react";
import "@mditor/editor/style.css";

function Page() {
  const [md, setMd] = useState("# 제목\n");
  return <MarkdownEditorView value={md} onChange={setMd} locale="ko" preview style={{ height: 600 }} />;
}
```

`ref` 로 편집기 손잡이(`MarkdownEditor`)를 받는다. `toolbarStart` · `toolbarEnd` 로 도구 막대 앞뒤에 내 단추를 넣는다.

### 화면 없이(읽기 · 쓰기 · HTML)

```ts
import { parseMarkdown, docToMarkdown, renderHtml } from "@mditor/editor/core"; // TipTap 을 싣지 않는다

const doc = parseMarkdown(md);   // MD → 문서(JSON). 고칠 곳이 있으면 MdError(line, code)
docToMarkdown(doc);              // 문서 → 표준 꼴 MD
renderHtml(md);                  // MD → HTML(링크는 안전한 주소만)
```

## 옵션

| 이름 | 기본 | 뜻 |
|---|---|---|
| `element` | (꼭) | 편집기를 넣을 요소 |
| `markdown` / `doc` | `""` | 처음 내용(MD 또는 문서 JSON) |
| `locale` | `"ko"` | 화면 글 언어 |
| `messages` | | 화면 글 바꾸기(`Partial<Messages>`) |
| `dialect` | 자동 | 서식 태그 언어 — `{빨강}` / `{red}`. 주지 않으면 MD 에 처음 나오는 태그, 없으면 `locale` |
| `toolbar` | `DEFAULT_TOOLBAR` | 도구 막대 항목 배열, `false` 면 없음 |
| `preview` | `false` | 미리보기 창을 열어 둔다 |
| `pageMarks` | `false` | 자동 쪽 나눔(쪽 경계)을 처음부터 보인다 — 경계 자리는 `setPageMarks` 로 넘긴다 |
| `mode` | `"wysiwyg"` | 처음 모드 — `"source"` 면 MD 원문 |
| `statusbar` | `true` | 글자 수 줄 |
| `editable` | `true` | 고칠 수 있는가 |
| `placeholder` | | 빈 문서의 안내 글 |
| `contentClass` | `"mde-doc"` | 문서 영역의 class(내 문서 모양을 쓸 때) |
| `image.upload` | data: 주소 | `(file) => Promise<주소>` — 파일을 올리고 문서에 적을 주소 |
| `image.resolve` | 그대로 | 문서의 그림 이름 → 화면에 그릴 주소 |
| `image.onFiles` / `image.pick` | | 그림 파일 · 이미지 단추를 직접 다룰 때 |
| `onChange` | | `(markdown, editor) => void` |
| `maxLength` | 없음 | 문서(MD) 길이 한도 — 붙이면 넘는 붙여넣기(문서 · 원문 모드)를 받지 않는다. 손으로 치는 글은 막지 않는다 |
| `onTooLong` | 편집기 위 줄에 알림 | `({ length, max }) => void` — maxLength 때문에 붙여넣기를 막았을 때 |
| `extensions` | | 더 붙일 TipTap 확장 |

### 도구 막대 항목

`undo` `redo` `blockKind` `bold` `italic` `underline` `strike` `color` `highlight` `link` `code` `superscript` `subscript` `removeFormat`
`bulletList` `orderedList` `taskList` `outdent` `indent` `align` `table` `image` `codeBlock` `horizontalRule` `pageBreak` `specialChars`
`find` `source` `preview` `fullscreen` `pageMarks`(기본 막대에는 없다), 구분선 `"|"`, 직접 그리는 항목 `{ name, render: (editor) => HTMLElement }`.

```ts
createEditor({ element, toolbar: ["bold", "italic", "|", "link", "|", "preview", { name: "save", render: () => mySaveButton }] });
```

## 손잡이(`MarkdownEditor`)

| | |
|---|---|
| `getMarkdown()` · `setMarkdown(md)` | MD 읽기 · 바꾸기(읽을 수 없는 MD 면 `MdError`) |
| `getDoc()` · `setDoc(doc)` · `getHTML()` | 문서 JSON · 미리보기 HTML |
| `setMode("wysiwyg" \| "source")` | 문서 ↔ MD 원문. 원문이 틀리면 `false` 와 함께 오류 줄을 보인다 |
| `setPreview(on)` · `isPreview()` | 미리보기 켜고 끄기 |
| `setPageMarks(marks)` · `setPageMarksVisible(on)` · `isPageMarksVisible()` | 자동 쪽 나눔 — 쪽 경계를 받아 그리고 켜고 끈다 |
| `setFullscreen(on)` · `setEditable(on)` · `setDialect(d)` | |
| `insertImage(src, caption?)` · `replaceImage(from, to)` · `refreshImages()` | 그림 |
| `on("change" \| "mode" \| "preview" \| "fullscreen" \| "pagemarks", fn)` | 알림(끊는 함수를 돌려준다) |
| `slot("start" \| "end")` | 도구 막대 앞뒤 빈칸(내 단추 넣기) |
| `tiptap` | 속의 TipTap `Editor` |
| `destroy()` | |

단축키: 굵게 ⌘B · 기울임 ⌘I · 밑줄 ⌘U · 코드 ⌘E · 링크 ⌘K · 형광펜 ⌘⇧H · 위/아래 첨자 ⌘. ⌘, · 번호/글머리/할 일 목록 ⌘⇧7/8/9 · 코드 블록 ⌘⌥C · 쪽 나눔 ⌘Enter · 찾기 ⌘F · 들여쓰기 Tab/⇧Tab (윈도에서는 ⌘ 대신 Ctrl).

### 자동 쪽 나눔

편집기는 쪽을 짐작하지 않는다. 쪽이 넘어가는 자리는 쓰는 쪽이 계산해 넘긴다(MDitor 서버는 `POST /api/md/preview-pages` 로 PDF 를 실제로 그려 본 쪽 배치를 준다).
자리는 문서(JSON)의 순번으로 적는다 — 편집기가 같은 규칙으로 블록을 묶으므로 순번이 맞는다.

```ts
editor.setPageMarks({
  total: 4,
  sections: { 2: 3 },                         // 셋째 섹션(## …)이 3쪽에서 시작
  blocks: {
    0: { items: { 12: 2 } },                  // 첫 블록(목록)의 13번째 항목부터 2쪽
    5: { rows: { 30: 4 } },                   // 여섯째 블록(표)의 31번째 본문 행부터 4쪽
    7: { before: 4 },                         // 여덟째 블록 앞에서 쪽이 넘어간다
  },
});
editor.setPageMarksVisible(true);             // 또는 도구 막대 항목 "pageMarks"
```

새 경계가 오기 전까지는 글을 고쳐도 경계가 글을 따라 움직이고, 경계는 MD 에 들어가지 않는다. 켜 두면 글자 수 줄에 전체 쪽 수가 나온다.

## 문법

일반 Markdown(CommonMark/GFM)의 한 부분과 MDitor 의 보고서 문법이다. 일반 MD 뷰어로 열어도 읽힌다.

```markdown
# 문서 제목
## 큰 제목(섹션)
### 작은 제목(블록 제목)

**굵게** ~~취소선~~ ==형광펜== `코드` [링크](https://example.com) H<sub>2</sub>O x<sup>2</sup>
{기울임}기울임{/기울임} {밑줄}밑줄{/밑줄} {음영}음영{/음영} {빨강}빨강{/빨강} {#2e8b57}아무 색{/#2e8b57}
{가운데}가운데 정렬 문단{/가운데}   ← {오른쪽} {양쪽} · 영어 {center} {right} {justify}

- 글머리
  - 하위(3단계까지)
1. 번호
- [ ] 할 일
- [x] 끝낸 일
> 비고(블록 아래 작은 글씨)

| 머리 | 합친 머리 | < |
| ^ | 왼쪽 | 오른쪽 |
|:---|:---|---:|
| 칸 | {음영}칸 음영{/음영} | 1 |

![그림 설명](image.png)

​```js
코드 블록
​```

---                     ← 가로줄
<!-- pagebreak -->      ← 쪽 나눔(PDF)
```

- 태그는 한국어 이름과 영어 이름이 같다: `{red}` `{blue}` `{gray}` `{italic}` `{underline}` `{shade}`. 한 문서는 한 가지 이름으로 쓴다.
- 기호를 글자로 쓰려면 앞에 `\`: `\*\*`, `\[`, `` \` ``, `1\.`.
- 없는 것: 기울임 `*글*`(→ `{기울임}`), `####` 이하 제목(→ `###`), 각주, 수식, 동영상.

## 모양 바꾸기

모든 class 는 `.mde` 로 시작한다. 색 · 글꼴은 변수로 바꾼다.

```css
.my-editor .mde {
  --mde-accent: #6d28d9;
  --mde-font: "Noto Sans KR", sans-serif;
  --mde-doc-width: 720px;
  --mde-min-height: 480px;
}
```

문서 영역의 모양을 내 것으로 쓰려면 `contentClass: "my-doc"` 를 주고 그 class 에 `h1 h2 h3 p .md-list li[data-num] .md-check table pre code hr .md-pagebreak .md-note mark.md-mark` 모양을 정한다.

## 묶기 · 내기

```bash
cd web/packages/editor
npm run build      # dist/: index.js · core.js · react.js(ESM) + mditor-editor.umd.js + style.css + types/
npm run dev        # demo/ — 서버 없이 돌려 보기
cd ../.. && npx vitest run packages   # 시험(서버와 같은 결과인지 공유 기준 파일로 확인)
```

npm 에 낼 때: `package.json` 의 `"private": true` 를 빼고, 이름(`@mditor/editor`)과 라이선스를 정한 뒤 `npm publish --access public`.

## 구조

| 경로 | 내용 |
|---|---|
| `src/core/` | 글 서식 · MD 읽기 · 쓰기 · HTML — 서버 `src/mditor/inline.py` `md.py` 와 **같은 규칙**(고치면 둘 다) |
| `src/pm/` | TipTap 스키마 · 변환(문서 ↔ 편집기) · 명령 · 플러그인(번호 · 찾기) |
| `src/ui/` | 도구 막대 · 팝업 · 찾아 바꾸기 · 원문 · 미리보기 · 화면 글 |
| `src/react.tsx` | React 감싸개 |
| `src/fixture.json` | 공유 기준 파일 — 서버 테스트(`tests/test_fixture.py`)가 만든다 |
