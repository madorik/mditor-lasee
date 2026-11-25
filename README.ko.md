# MDitor LaSee (라씨)

[English](README.md) · 한국어 — 이 문서는 운영 · 개발 메모까지 담은 한국어판이다. 쓰는 법만 보려면 영문 README.

보고서 같은 정형 문서를 **보이는 모양 그대로 고치면서**, 원본은 **Markdown** 으로 남기고(AI 도 같은 MD 를 고친다),
미리보기의 **쪽 경계가 PDF 와 같은** 문서 편집기.

- **웹 서비스** — 왼쪽에서 고치고(문서 / MD), 오른쪽에서 확인한다(미리보기 / PDF). 오른쪽 미리보기는 끄고 켤 수 있고, 같은 쪽 경계를 문서 탭 안에도 그리는 ‘자동 쪽 나눔’ 을 켤 수 있다(둘 다 브라우저가 기억한다).
  가입 없음, 문서는 브라우저에만 보관.
  한국어(`/`)와 영어(`/en/`)로 낸다.
- **MCP 서버** — AI 에이전트가 같은 문법으로 문서를 쓰고, 검사하고, 쪽 배치를 보고, PDF 로 낸다.
- **HTTP API** — 같은 기능을 직접 부른다.
- **편집기 라이브러리** `@watalabs/lasee-mditor` (`web/packages/lasee-mditor`) — 웹 서비스의 문서 편집기를 떼어 낸 것. 서버 없이 돌고,
  npm(ESM) · `<script>`(UMD) · React 로 쓴다. 자세한 것은 [`web/packages/lasee-mditor/README.md`](web/packages/lasee-mditor/README.md).

웹 서비스의 이름은 **MDitor LaSee**(한국어로는 **MDitor 라씨**)다. 문서 형식과 MCP 서버·Python 패키지 이름은 `MDitor`/`mditor` 그대로 둔다.
npm 으로 내는 편집기는 회사 스코프의 **`@watalabs/lasee-mditor`** 다(npm 의 `mditor` 는 이미 다른 사람의 마크다운 편집기라 쓰지 않는다).

셋 다 같은 파서와 렌더러(`src/mditor`)를 쓴다. 그래서 사람이 화면에서 보는 쪽과 에이전트가 보는 쪽과 PDF 의 쪽이 같다.

## 구조

```
 문서(JSON) ──doc_md──▶  MD  ◀──fromPM── 문서 편집기(TipTap)          화면(web/)
     ▲                   │                    ▲ toPM
     └────apply_md───────┘                    │
                         │          서버가 되읽은 문서(JSON)
   MD ─(300ms)─▶ POST /api/md/preview        → 되읽은 문서 · 변경 표시 · 오류 줄
   MD ─(1.2s)──▶ POST /api/md/preview-pages  → PDF 를 실제로 그려 본 쪽 배치 → 화면에 'n쪽' 경계
   MD ─(1.2s)──▶ POST /api/md/preview-pdf    → PDF 그대로
   MD ─────────▶ POST /api/md/revise         → AI 가 MD 를 받아 MD 로 돌려줌
                 /mcp                         → MCP(Streamable HTTP)
```

지키는 것:

1. **원본은 구조 문서(JSON), MD 는 편집 표현.** 블록마다 안정된 id 가 있고, MD 를 되읽을 때 원래 블록과 id 를 잇는다.
2. **MD 규칙은 둘이 같다.** 서버(`src/mditor/inline.py` `md.py`)와 편집기 패키지(`web/packages/lasee-mditor/src/core/`)가 같은 규칙으로 MD 를 읽고 쓴다 —
   읽은 문서도, 쓴 MD 도 **바이트 단위로 같다**(공유 기준 파일이 잡는다. 어긋나면 화면 쪽이 기준 구현이다).
   웹 서비스는 여전히 서버가 되읽은 문서(id 를 이은 것)로 편집기를 열고, 화면의 파서는 라이브러리(서버 없이 쓸 때 · MD 붙여넣기 · 원문 모드)가 쓴다.
3. **쪽은 화면에서 짐작하지 않는다.** 서버가 PDF 를 그리면서 블록·항목·표 행이 놓인 쪽을 적고, 화면은 쪽 번호가 바뀌는 자리에 경계를 그린다.
   문서 탭의 자동 쪽 나눔도 같은 결과를 섹션·블록 순번으로 옮겨 그린다(`web/src/lib/pages.ts` `editorMarks` → 편집기 `setPageMarks`). 미리보기와 자동 쪽 나눔이 모두 꺼져 있으면 쪽 계산을 부르지 않는다.
4. **서버는 상태를 두지 않는다.** 문서·판본·그림은 브라우저(IndexedDB)에 있다.

| 경로 | 내용 |
|---|---|
| `src/mditor/inline.py` `table.py` `md.py` | 글 서식 · 표 칸 합치기 · MD 쓰기/읽기/id 잇기 |
| `src/mditor/render.py` | PDF(reportlab) + 쪽 배치 기록, 쪽 나눔 규칙 |
| `src/mditor/core.py` | API 와 MCP 가 같이 쓰는 동작 |
| `src/mditor/api.py` | FastAPI 서버(정적 사이트 포함) |
| `src/mditor/mcp_server.py` | MCP 서버(stdio · HTTP) |
| `src/mditor/ai.py` | AI 수정(Claude) |
| `src/mditor/data/syntax.md` | 문법 안내(MCP `syntax_guide` 와 AI 프롬프트가 쓴다) |
| `src/mditor/data/example.md` `example.en.md` | 예시 문서(편집기 '예시 보기', 공유 기준 파일) |
| `src/mditor/i18n.py` | 서버 문구의 언어(`Accept-Language`) — 한국어 원문이 열쇠, 영어 사전 |
| `web/packages/lasee-mditor/src/core/` (`inline.ts` `parse.ts` `write.ts` `table.ts`) | 서버와 **같은 규칙** — 고치면 둘 다 고친다(화면 쪽이 기준 구현) |
| `web/packages/lasee-mditor/src/pm/` | TipTap 스키마 · 변환(toPM / fromPM) · 명령 |
| `web/packages/lasee-mditor/src/ui/` `react.tsx` | 편집기 화면(도구 막대 · 찾아 바꾸기 · 표/코드 도구 · 원문 · 미리보기) · React 감싸개 |
| `web/src/editor/` | 편집 화면(편집기 패키지를 감싼 `RichEditor.tsx`, MD 탭, 쪽 미리보기) |
| `web/src/lib/i18n.ts` `i18n/en.ts` | 편집 화면 문구의 언어 — 한국어 원문이 열쇠, 영어 사전 |
| `web/*.html` `web/en/*.html` | 첫 화면 · 편집기 · 문법 · 개발자 · 개인정보처리방침 · 이용약관 (한국어 · 영어) |
| 첫 화면 `#lasee-mditor` 칸 · 모든 쪽 바닥글 | npm 패키지 · GitHub 저장소 링크 |
| `web/e2e/hero-video.mjs` `landing-images.mjs` | 첫 화면의 영상 · 그림 만들기(실제 편집기를 찍는다) |

## 돌려 보기

Python 3.10 이상(권장 3.12)과 [uv](https://docs.astral.sh/uv/), Node 20 이상이 필요하다.

```bash
uv sync --all-extras                       # 서버
cd web && npm install && npm run build     # 화면 → web/dist
cd .. && uv run mditor-server              # http://localhost:8000
```

화면을 고치는 중이면 서버를 띄워 둔 채 `cd web && npm run dev` (http://localhost:5173, `/api` 는 8000 으로 넘긴다).

## 검증

```bash
uv run pytest                 # 서버: 문법 왕복, id 잇기, 쪽 배치 ↔ PDF, API, MCP
cd web && npm test            # 화면 · 편집기 패키지: 서버와 같은 결과인지(공유 기준 파일), 편집기 명령, 무작위 왕복
cd web && npm run typecheck
node web/e2e/editor.mjs       # 헤드리스 크롬으로 편집 화면 조작(서버가 8011 에 떠 있어야 한다)
```

- **공유 기준 파일** `web/packages/lasee-mditor/src/fixture.json` 은 서버 테스트가 합성 문서(`tests/synthetic.py`)로 만든다.
  화면 테스트는 `문서 → 편집기 → MD` 가 서버 MD 와 같은지 본다. 문법을 고쳤으면 다시 만든다:
  `MDITOR_WRITE_FIXTURE=1 uv run pytest tests/test_fixture.py`
- `tests/test_render.py::test_layout_matches_the_pdf` 는 PDF 를 다시 읽어, 배치가 말한 쪽에 그 항목·표 행이 실제로 있는지 본다.
- e2e 는 한글 조합 입력(CDP `Input.imeSetComposition`), 칸 끌어 고르기, 워드·엑셀 붙여넣기, 탭 전환, 저장·임시저장, 쪽 경계를 본다.
  실제 OS 입력기(Windows/Edge, macOS/Safari)는 사람이 확인해야 한다.

  ```bash
  PORT=8011 MDITOR_RATE_PER_MINUTE=100000 MDITOR_IMAGE_DIR=/tmp/mditor-e2e-images uv run mditor-server &
  node web/e2e/editor.mjs http://127.0.0.1:8011
  ```

## 편집기 패키지

`web/packages/lasee-mditor` 는 npm 에 [`@watalabs/lasee-mditor`](https://www.npmjs.com/package/@watalabs/lasee-mditor)(MIT)로 낸 편집기다(0.1.0 2026-11-26, 0.2.0 에서 API 이름을 MDitor 로 맞췄다 — `createMDitor` · `MDitor` · `MDitorView`).
npm 계정 `watalabs` 는 2단계 인증이 켜져 있어 낼 때 `npm publish --otp=<코드>` 가 필요하다. 패키지 README(영문)는 npm 쪽에 그대로 보인다.
웹 서비스는 Vite 별칭(`web/vite.config.ts` · `tsconfig.json` 의 `@watalabs/lasee-mditor`)으로 소스를 바로 쓴다.

```bash
cd web/packages/lasee-mditor
npm run build   # dist/: index.js · core.js · react.js(ESM) · lasee-mditor.umd.js · style.css · types/
npm run dev     # demo/index.html(ESM) — 서버 없이. demo/umd.html 은 build 뒤 <script> 로 쓰는 예
```

- `@watalabs/lasee-mditor` — `createMDitor({ element, markdown, onChange })`. 도구 막대 · 표 도구 · 찾아 바꾸기 · 특수 문자 · MD 원문 · 미리보기(켜고 끄기) · 전체 화면 · 글자 수.
- `@watalabs/lasee-mditor/core` — 화면 없이 `parseMarkdown` · `docToMarkdown` · `renderHtml`(TipTap 을 싣지 않는다).
- `@watalabs/lasee-mditor/react` — `<MDitorView value onChange … />`.
- 웹 서비스는 원문 · 미리보기 · 전체 화면 단추를 빼고(탭과 오른쪽 창이 맡는다) 글꼴 칸을 끼워 쓴다(`web/src/editor/RichEditor.tsx`).

## 언어

한국어는 뿌리(`/`, `/edit`, `/syntax` …), 영어는 `/en/` 아래(`/en/`, `/en/edit` …)에 같은 이름으로 있다.
쪽마다 `hreflang` 대안 주소와 다른 언어로 가는 링크가 있다. 문서는 브라우저에 있으므로 두 언어 편집기가 같은 문서를 본다.

- **편집 화면** — `<html lang>` 으로 언어를 정한다(`web/en/edit.html`). 문구는 `t("한국어 원문")` 으로 쓰고 영어는 `web/src/lib/i18n/en.ts` 에 넣는다.
  빠진 번역은 테스트(`i18n.test.ts`)가 잡는다.
- **서버 문구** — 요청의 `Accept-Language`(편집기는 화면 언어를 보낸다)로 정한다. 문구는 `t("한국어 원문")`, 영어는 `src/mditor/i18n.py`.
  빠진 번역은 `tests/test_i18n.py` 가 잡는다. MCP 는 한국어다.
- **서식 태그** — `{빨강}` · `{red}` 처럼 한국어 이름과 영어 이름이 같은 태그다. 문서는 한 가지 이름으로 쓴다:
  문서에 처음 나오는 짝 맞은 태그의 이름을 따르고(섞이면 그 이름으로 맞춘다), 태그가 없으면 요청 언어를 따른다.
  서버(`inline.dialect_of`)와 화면(`dialectOf`)이 같은 규칙이고, 공유 기준 파일에 영어 태그 사례도 들어 있다.
- **언어를 더하려면** — `i18n.py` 의 `LANGS` · 사전, `web/src/lib/i18n.ts` 의 `Lang` · 사전, `web/<언어>/*.html`,
  `web/vite.config.ts` 의 `LANGS`, 예시 문서를 더한다. 서버의 `/<언어>/` 주소는 `i18n.LANGS` 를 따라 열린다.

첫 화면의 영상과 그림은 실제 편집기를 찍어 만든다. 편집 화면이 바뀌면 두 언어 모두 다시 만든다(서버가 떠 있어야 하고, ffmpeg · cwebp 가 있어야 한다).

```bash
cd web
node e2e/hero-video.mjs http://127.0.0.1:8000 ko src/assets/hero        # hero-ko.mp4 · hero-ko.webp(포스터)
node e2e/hero-video.mjs http://127.0.0.1:8000 en src/assets/hero
node e2e/landing-images.mjs http://127.0.0.1:8000 ko src/assets/landing  # landing/ko/*.webp
node e2e/landing-images.mjs http://127.0.0.1:8000 en src/assets/landing
```

## 배포

컨테이너 하나다. 화면을 빌드해 API 서버에 담는다.

```bash
docker build -t mditor .
docker run -p 8000:8000 --env-file .env mditor
```

`.env.example` 을 `.env` 로 복사해 채운다. 꼭 정할 것은 `MDITOR_PUBLIC_URL` 하나다.

| 환경변수 | 뜻 |
|---|---|
| `MDITOR_PUBLIC_URL` | 서비스 주소(끝에 `/` 없이). 사이트맵, 문서 링크, MCP 의 PDF 링크에 쓴다 |
| `ADSENSE_CLIENT` | AdSense 게시자 ID(`ca-pub-…`). 비우면 광고 코드를 넣지 않는다 |
| `ADSENSE_SLOT_CONTENT` / `ADSENSE_SLOT_EDITOR` | 내용 쪽 / 편집 화면 아래 띠의 광고 단위 ID |
| `GOOGLE_SITE_VERIFICATION` | Search Console 소유 확인 값 |
| `MDITOR_CONTACT_EMAIL` | 개인정보처리방침·약관에 보일 문의 주소 |
| `ANTHROPIC_API_KEY` | 있으면 ‘AI 로 고치기’ 가 켜진다 |
| `MDITOR_AI_MODEL` `MDITOR_AI_EFFORT` `MDITOR_AI_DAILY_LIMIT` `MDITOR_AI_MAX_MD_CHARS` | AI 수정의 모델·노력 수준·IP 당 하루 횟수·문서 길이 한도 |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | 넷이 모두 있으면 그림을 Cloudflare R2 에 올린다(아래 ‘그림 저장소’) |
| `MDITOR_IMAGE_DIR` | R2 대신 그림을 둘 디스크 폴더(도커 볼륨 · 로컬 개발) |
| `MDITOR_MAX_IMAGE_FILE_BYTES` `MDITOR_MAX_UPLOAD_BYTES` `MDITOR_UPLOAD_DAILY_LIMIT` | 원본 그림 파일 한도(10MB) · 줄여 올리는 한 장 한도(3MB) · IP 당 하루 올리기 수(100) |
| `MDITOR_IMAGE_TTL_DAYS` | 올린 그림을 두는 날 수(3). R2 는 버킷 수명 규칙과 맞춘다 |
| `MDITOR_RATE_PER_MINUTE` | IP 당 분당 요청 수(미리보기·PDF·MCP) |
| `MDITOR_LIVE_RENDER_CHARS_PER_MINUTE` | 고치는 동안 저절로 가는 쪽 계산 · PDF 보기의 탭 당 분당 글자 수(200만). 넘으면 잠시 쉰다(429) |
| `MDITOR_TRUST_PROXY` | 프록시 뒤면 `1`(기본). `X-Forwarded-For` 로 IP 를 센다 |
| `WEB_CONCURRENCY` | 프로세스 수. 2 이상이면 횟수 제한을 프로세스마다 따로 센다 |

서버는 문서를 저장하지 않으므로 디스크가 필요 없다(MCP 가 만든 PDF 만 `/tmp` 에 30분 둔다).
그래서 여러 대로 늘릴 때는 MCP 의 PDF 링크가 만든 서버에서만 열린다는 점만 주의한다.

### Vercel

지금 서비스는 Vercel 프로젝트 `mditor` 에 올라가 있다 — https://lasee.watalabs.com (함수 리전 서울 `icn1`).
예전 주소 https://mditor.watalabs.com 은 같은 경로의 새 주소로 넘긴다(308, `vercel.json` 의 `redirects`).
Git 과 잇지 않았으므로 바뀐 것을 올릴 때는 이 폴더에서 직접 배포한다.

```bash
vercel deploy --prod
```

| 파일 | 하는 일 |
|---|---|
| `app.py` | Vercel 진입점. `src` 의 앱을 `app` 으로 내보내고, 함수 본문 한도(4.5MB)에 맞춰 그림 한도를 3MB 로 줄인다 |
| `vercel.json` | 빌드 명령(화면 빌드 → `web/dist`), 리전, 함수 묶음에서 뺄 파일 |
| `.vercelignore` | 올리지 않을 파일(`.venv`, `node_modules`, `web/dist` 등) |

- Vercel 은 `uv sync --no-dev` 로 설치하고 엑스트라는 깔지 않는다. 그래서 서버 의존성을 `[server]` 엑스트라와 같은 기본 그룹 `server` 로도 둔다(둘이 같은지 `tests/test_packaging.py` 가 본다).
- 환경변수는 Vercel 프로젝트에 둔다(`vercel env add 이름 production`). `MDITOR_PUBLIC_URL`, 그림 저장소(R2) 넷, 광고(`ADSENSE_CLIENT` · `ADSENSE_SLOT_CONTENT` · `ADSENSE_SLOT_EDITOR`) 셋이다.
- 함수가 여러 개 뜰 수 있다. 횟수 제한은 함수마다 따로 세고, MCP 가 만든 PDF 링크는 만든 함수가 아닌 곳으로 가면 만료로 나올 수 있다.

### 광고

1. AdSense 에 사이트를 등록하고 `ADSENSE_CLIENT` 를 넣는다. 서버가 모든 쪽의 `<head>` 에 AdSense 코드를 넣고 `/ads.txt` 를 만들어 준다.
2. 광고 단위를 둘 만들어 ID 를 `ADSENSE_SLOT_CONTENT`(반응형 디스플레이), `ADSENSE_SLOT_EDITOR`(가로형) 에 넣는다.
   - 내용 쪽: 첫 화면·문법·개발자 쪽의 본문 사이/아래
   - 편집 화면: 맨 아래 띠 하나(편집을 가리지 않는다)
3. AdSense 의 ‘개인 정보 보호 및 메시지’ 에서 동의 메시지(유럽 등)를 켠다.
4. `/privacy` 와 `/terms` 의 운영자 정보를 실제에 맞게 고친다(`web/privacy.html`, `web/terms.html`).

광고 자리는 `?ads=demo` 를 붙이면 볼 수 있다(예: `/edit?ads=demo`).
광고가 실제로 채워졌을 때(`data-ad-status="filled"`)만 자리를 펼친다 — 심사 중 · 광고 없음 · 차단이면 빈 띠를 남기지 않는다.
광고를 못 채우면 AdSense 가 바깥 요소에 `height: auto !important` 를 박아 편집 화면이 늘어나므로, 편집 화면은 그 높이를 곧바로 지운다(`web/src/editor/AdSlot.tsx`).

**쿠팡 파트너스 추천 칸** — 한국어 첫 화면·문법·개발자 쪽의 광고 자리 위에 카드 넷(맥북·맥미니·에어팟·키보드)을 낸다. 팝업이 아니고 편집기에는 내지 않는다.

- 목록과 링크는 `web/src/lib/picks.ts`. 칸마다 `search`(찾을 말)를 파트너스의 상품 링크 검색
  (`https://partners.coupang.com/#affiliate/ws/link/0/<search>`)에 넣고, 본체 가운데 많이 팔리는 상품을 골라 '링크 생성'으로 만든 단축 주소
  (`https://link.coupang.com/a/…`)를 `url` 에 넣는다. 쿠팡 검색 화면 주소로 만든 링크는 일부 브라우저에서 '사용권한이 없습니다'로 막혀서 쓰지 않는다.
  상품이 품절되거나 새 모델이 나오면 링크를 바꾼다.
- `url` 이 비었거나 파트너스 주소가 아닌 칸은 그리지 않고, 하나도 없으면 칸 전체를 그리지 않는다(`lib/picks.test.ts` 가 본다).
- 칸 가까이에 "광고" 표시와 파트너스 고지 문구가 있고, 링크는 `rel="sponsored nofollow noopener"` 로 연다. `/privacy` 에도 한 줄 있다.
- 파트너스 사이트(partners.coupang.com)는 자동으로 띄운 브라우저를 막는다(Akamai `Access Denied`). 링크는 사람이 직접 만든다.

**쿠팡 파트너스 다이나믹 배너** — 파트너스 > 다이나믹 배너로 만든 코드를 `web/src/lib/banners.ts` 의 `BANNERS` 에 `html` 로 그대로 붙인다(코드가 없는 자리는 안 그린다).

| 자리(`slot`) | 크기 | 놓이는 곳 |
|---|---|---|
| `middle` | 680×140 | 한국어 첫 화면의 첫 소개 바로 아래 |
| `bottom` | 680×140 | 첫 화면·문법·개발자 쪽의 광고 자리 위. 있으면 추천 카드 대신 이걸 낸다 |
| `side` | 160×600 | 화면 폭 1500px 이상일 때 본문 오른쪽 옆. 쪽과 같이 올라가고 따라다니지 않는다 |
| `export` | 680×140 | 한국어 편집기에서 내보내기(PDF · MD · 링크)를 하면 열리는 안내 창 안 (`web/src/editor/ExportAd.tsx`) |

- 화면을 덮는 팝업과 스크롤을 따라다니는(플로팅) 배너는 쓰지 않는다 — 쿠팡 파트너스가 금지했다는 글이 있다(2025-01 플로팅·더보기 배너, 2026-06 커버형. 공식 공지로 확인할 것).
- 쿠팡 코드는 쪽에 직접 심는다(`web/src/banners.ts`). 우리 iframe · sandbox · data: 주소 안에 넣거나 쿠팡 위젯 주소를 직접 쓰면 쿠팡 위젯이 내용을 줄여서 그린다(사진 29장 → 1장).
  그래서 보안 격리는 없다 — 쿠팡 스크립트는 이 사이트와 같은 출처에서 돌아 브라우저 저장소에 닿을 수 있다(구글 애드센스 스크립트가 모든 쪽에 이미 그렇듯).
  그래서 편집기(`/edit`)에는 평소에 쿠팡 스크립트를 싣지 않고, 내보내기 안내 창이 열릴 때만 불러온다. 격리하려면 다른 출처의 호스트에서 서빙해야 한다. 쿠팡 주소가 아닌 곳을 부르는 코드는 받지 않는다(`lib/banners.test.ts`).
- 쿠팡 `g.js` 는 만든 배너를 `body` 끝에 붙이므로, 만들어지면 자리 안으로 옮긴다. 자리마다 하나씩 차례로 돌린다(`web/src/lib/coupangMount.ts`).
- 내보내기 안내 창은 사용자가 내보내기를 눌러서 연 창 안의 배너다. 영어 편집기 · 배너 코드가 없을 때 · 자동화 브라우저(e2e)에서는 열지 않고 예전처럼 바로 내보낸다.
- 영어 쪽에는 내지 않는다. 주소에 `?ads=demo` 를 붙이면 자리만 볼 수 있다(예: `/?ads=demo`).

### 검색 · 답변 엔진(SEO · AEO · GEO)

- 쪽마다 제목 · 설명 · canonical · hreflang(ko · en · x-default), og · 트위터 카드(`web/public/og-ko.png` · `og-en.png`, 1200×630)를 둔다.
- 구조화 데이터(JSON-LD): 첫 화면은 `WebSite` · `WebApplication` · `FAQPage`(보이는 FAQ 와 같은 글 — `tests/test_seo.py` 가 본다),
  문법 · 개발자 쪽은 `TechArticle` · `BreadcrumbList`, 개인정보 · 약관은 `BreadcrumbList`.
- `/sitemap.xml` 은 쪽마다 언어별 대안 주소와 고친 날(빌드한 날)을 싣는다. `/robots.txt` 는 검색 · AI 크롤러(GPTBot · ClaudeBot ·
  PerplexityBot · 네이버 Yeti 등)를 이름으로 허용한다. `/llms.txt` 는 AI 답변 엔진용 사이트 안내다(`src/mditor/data/llms.md`).
- 소유 확인: `GOOGLE_SITE_VERIFICATION` · `NAVER_SITE_VERIFICATION` · `BING_SITE_VERIFICATION` 를 넣으면 모든 쪽 머리에 들어간다.
- 방문 통계: Vercel Web Analytics(`@vercel/analytics`, `web/src/analytics.ts`). 모든 쪽이 불러오고, Vercel 에 배포한 곳(`VERCEL=1`, 또는
  `MDITOR_ANALYTICS=1`)에서만 켠다. 주소의 `#` 뒤(문서가 든 링크의 문서 내용)는 보내지 않는다. Vercel 프로젝트의 Analytics 를 켜 두어야 모인다.
- 공유 이미지는 첫 화면 영상의 포스터(`hero-*.webp`)로 만든다. 편집 화면이 바뀌면 영상 · 그림과 함께 다시 만든다.

### 그림 저장소

편집기에서 넣은 그림은 화면이 긴 변 1600px 로 줄여 `POST /api/images` 로 올린다. 서버는 그림을 다시 그려(EXIF 등 메타데이터를 버린다)
`<해시32자>-<가로>x<세로>.png|jpg` 이름으로 저장소에 두고, 문서에는 `![설명](https://<서비스 주소>/i/<이름>)` 이 들어간다.

- 저장소: R2 설정 넷이 있으면 Cloudflare R2, 아니면 `MDITOR_IMAGE_DIR` 폴더, 둘 다 없으면 꺼진다(그림은 예전처럼 문서와 함께 브라우저에).
- 버킷은 공개하지 않는다. 그림은 이 서버의 `/i/<이름>` 으로 내준다.
- 쪽 배치는 이름에 적힌 크기로 자리를 잡고(그림을 내려받지 않는다), PDF 는 이름으로 저장소에서 꺼낸다. 주소의 호스트는 보지 않으므로
  다른 곳에서 열린 MD 도 같은 그림이 들어가고, 바깥 주소로 요청을 보내지 않는다. 저장소의 그림이 아닌 주소는 그림 자리만 그린다.
- 남용 막기: 줄인 그림 한 장 3MB, IP 당 하루 100장, 다른 사이트(Origin)에서 오는 올리기는 거절한다.
- 보관: 올린 그림은 3일 뒤 지운다(`MDITOR_IMAGE_TTL_DAYS`). R2 는 버킷 수명 규칙이 지우므로 값을 바꾸면 규칙도 같이 바꾼다
  (`npx wrangler r2 bucket lifecycle add <버킷> expire-uploads-3d i/ --expire-days 3`). 폴더 저장소는 올릴 때 지난 것을 지운다.
  `/i/` 응답은 6시간만 담아 두게 해서 지운 그림이 CDN · 브라우저에 오래 남지 않는다.
- R2 준비: Cloudflare 대시보드 → R2 → 버킷 만들기(공개 접근은 끈 채로) → ‘R2 API 토큰 관리’ 에서 그 버킷에 ‘객체 읽기 및 쓰기’ 토큰을 만들고,
  나오는 Access Key ID · Secret Access Key 와 계정 ID, 버킷 이름을 환경변수 넷에 넣는다.

### AI 로 고치기

`ANTHROPIC_API_KEY` 를 넣으면 켜진다. Claude 가 고친 섹션만 돌려주고 서버가 합친 뒤 되읽어 검사한다.
호출마다 비용이 들므로 IP 당 하루 횟수(`MDITOR_AI_DAILY_LIMIT`)와 문서 길이(`MDITOR_AI_MAX_MD_CHARS`)를 제한한다.
안전 분류기가 요청을 거절하면 같은 호출 안에서 대체 모델이 이어 받도록 되어 있다(`fallbacks="default"`).

## MCP

### 원격(서비스에 붙기)

```bash
claude mcp add --transport http mditor https://lasee.watalabs.com/mcp
```

```json
{ "mcpServers": { "mditor": { "type": "http", "url": "https://lasee.watalabs.com/mcp" } } }
```

### 로컬(stdio)

PDF 를 파일로 바로 쓰고, 문서에 적힌 그림 파일을 디스크에서 읽는다. 네트워크를 쓰지 않는다.

```bash
uvx --from git+https://github.com/madorik/mditor-lasee mditor-mcp
```

```json
{
  "mcpServers": {
    "mditor": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/madorik/mditor-lasee", "mditor-mcp"],
      "env": { "MDITOR_PUBLIC_URL": "https://lasee.watalabs.com" }
    }
  }
}
```

`MDITOR_PUBLIC_URL` 을 주면 ‘웹 편집기에서 열기’ 링크를 만드는 `editor_link` 도구가 생긴다.

### 도구

| 도구 | 하는 일 |
|---|---|
| `syntax_guide` | 문법 전체. 쓰기 전에 한 번 읽는다 |
| `check_markdown` | 문서를 읽어 본다 → 뼈대와 표준 꼴 MD, 또는 오류 줄 |
| `page_layout` | PDF 를 그려 보고 섹션·블록이 놓인 쪽, 긴 표·목록이 넘어가는 자리 |
| `render_pdf` | PDF 만들기(로컬: 파일로 / 원격: 30분짜리 링크) |
| `diff_markdown` | 두 판을 블록 단위로 견주고, 새로 나온 숫자를 알려 준다 |
| `editor_link` | 문서를 웹 편집기에서 여는 링크(내용은 주소의 # 뒤에 실린다) |

자원 `mditor://syntax`, `mditor://example` 과 프롬프트 `write_document` 도 있다.

## 문법

[`src/mditor/data/syntax.md`](src/mditor/data/syntax.md). 요약:

```markdown
# 문서 제목

## 1. 섹션

### 블록 제목
- 항목 **굵게** {기울임}기울임{/기울임} {빨강}빨강{/빨강} {밑줄}밑줄{/밑줄}   ← 영어 이름도 같다: {italic} {red} {underline}
  - 하위 항목<br>줄바꿈
> 비고

| 분야 | 매출 | < |
| ^ | 종이책 | 전자책 |
|:---|---:|---:|
| 문학 | {음영}412{/음영} | 96 |
```

## 알아 둘 것

- 서버가 여러 프로세스면 요청 횟수 제한을 프로세스마다 따로 센다. 정확히 제한하려면 앞단(프록시·CDN)에서 한다.
- **큰 글에 버티기** — 문서는 `MDITOR_MAX_MD_CHARS`(40만 자)까지다.
  - 화면: 붙이면 한도를 넘는 붙여넣기(문서 탭 · MD 탭)는 받지 않고 알린다. 한도를 넘은 문서는 서버에 보내지 않고 안내한다.
    큰 문서일수록 미리보기(300ms → 1.5초) · 쪽 계산(1.2초 → 6초) 요청 간격을 늘린다.
  - 서버: 화면이 고치는 동안 저절로 보내는 요청(`live: true`)은 탭(`X-Mditor-Client`, 없으면 IP)마다 한 줄로 세워
    차례가 왔을 때 더 새 요청이 와 있으면 건너뛴다(409) — 버려진 요청까지 PDF 를 그려 다른 사람의 요청이 밀리던 것을 막는다.
    쪽 계산 · PDF 보기는 탭 당 분당 글자 수(`MDITOR_LIVE_RENDER_CHARS_PER_MINUTE`)도 센다(429). 저장 · PDF 내려받기 · API · MCP 는 건너뛰지 않는다.
  - 계산 줄이기(2026-11-26, 40만 자 문서에서 멈출 때마다 서버 CPU 약 3.5초 → 1.6초):
    쪽 계산은 PDF 를 그리지 않고 배치만 한다(`render.render(draw=False)` — 그리기 · PDF 저장을 건너뛴다. 결과가 그린 PDF 와 같은지 `test_layout_only_is_the_same_as_the_drawn_pdf` 가 본다).
    같은 문서 · 설정의 쪽 계산은 기억해 둔다(`core._LAYOUTS`, 16개). 줄마다의 서식 다듬기(`inline.canon`)를 기억해 되읽기는 바뀐 줄만 계산한다(400자 이하 줄, 32,768개).
    렌더는 전역 잠금(`render._LOCK`) 안에서 돌므로 한 사람의 큰 문서가 다른 사람을 세워 두는 시간도 같이 준다.
  - 요청 줄이기: 화면은 64KB 넘는 요청을 gzip 으로 보낸다(`web/src/lib/api.ts`, 큰 문서의 미리보기 요청 2.8MB → 0.2MB 안팎). 서버는 `_Gunzip` 이 풀고, 풀린 크기도 본문 한도를 넘지 못한다.
    가는 길에서 못 풀면(400 · 415 · 검사 오류 목록 422) 한 번 줄이지 않고 다시 보내고 그 창에서는 더 줄이지 않는다.
  - 편집기: 고치지 않은 블록은 다시 변환하지 않는다(`jsonOf` — ProseMirror 노드마다 JSON 을 기억하고 그 객체에 서식 · 표 변환을 묶는다). 미리보기는 받는 값이 그대로면 다시 그리지 않는다(`memo`).
    38만 자 문서에서 한 글자 입력이 133ms → 50ms(자동화 도구 왕복 포함), 100ms 넘는 긴 작업이 없어졌다.
- **로딩** — 편집기는 서버를 기다리지 않고 화면의 파서로 바로 연다(서버가 식어 있어도). 편집기 덩어리는 HTML 에서 미리 받는다
  (`web/vite.config.ts` `preloadEditor`). 문서 글꼴(나눔 셋)의 웹 글꼴 정의는 고를 때 불러온다(`web/src/lib/fonts.ts`). 편집 화면은 광고 코드를
  쪽이 뜬 뒤 받는다(다른 쪽은 그대로 머리에). 첫 화면 영상은 쪽이 뜬 뒤 받아 틀고, 데이터 절약 · 아주 느린 망 · 움직임 줄이기에서는 포스터만 보인다.
- 문서 편집기 안의 쪽 경계(자동 쪽 나눔)는 기본으로 꺼져 있다. 켜면 미리보기와 같은 자리에 그리고, 서버가 쪽을 다시 계산하기 전까지는 글을 따라 움직인다.
  MD 탭에는 그리지 않는다.
- 목록은 글머리(`-`)와 번호(`1.`)·할 일(`- [ ]`), 블록은 코드(```` ``` ````)·가로줄(`---`)·쪽 나눔(`<!-- pagebreak -->`), 글 서식은 링크 `[글](주소)`·`` `코드` ``·`==형광펜==`·위/아래 첨자(`<sup>` `<sub>`)·문단 정렬(`{가운데}`)이 있다. 표·그림은 위와 같다. 전부 `src/mditor/data/syntax.md` 에 있다.
- 문서 글꼴은 쪽 설정에서 고른다: Pretendard JP(기본) · 나눔명조 · 나눔고딕 · 나눔손글씨 펜. 모두 SIL OFL 1.1 이다(`src/mditor/fonts/OFL-*.txt`).
  화면은 같은 글꼴의 웹 글꼴(`@fontsource/*`), PDF 는 같은 글꼴 파일로 그린다. 고른 글꼴에 없는 글자(한자 · 기호)는 둘 다 Pretendard 로 채운다.
  이모지는 나오지 않는다.
- 원본 글꼴에는 기울임체가 없어, PDF 의 기울임은 글자를 기울인 사본(`src/mditor/fonts/oblique/`, `scripts/make_oblique.py`)으로 그린다.
  OFL 의 예약된 글꼴 이름 때문에 사본의 이름은 'MDitor Oblique …' 이다. 화면은 브라우저가 기울임을 흉내 낸다(같은 각도).
