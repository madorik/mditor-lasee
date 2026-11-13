# MDitor LaSee (라씨)

보고서 같은 정형 문서를 **보이는 모양 그대로 고치면서**, 원본은 **Markdown** 으로 남기고(AI 도 같은 MD 를 고친다),
미리보기의 **쪽 경계가 PDF 와 같은** 문서 편집기.

- **웹 서비스** — 왼쪽에서 고치고(문서 / MD), 오른쪽에서 확인한다(미리보기 / PDF). 가입 없음, 문서는 브라우저에만 보관.
  한국어(`/`)와 영어(`/en/`)로 낸다.
- **MCP 서버** — AI 에이전트가 같은 문법으로 문서를 쓰고, 검사하고, 쪽 배치를 보고, PDF 로 낸다.
- **HTTP API** — 같은 기능을 직접 부른다.

웹 서비스의 이름은 **MDitor LaSee**(한국어로는 **MDitor 라씨**)다. 문서 형식과 MCP 서버·패키지 이름은 `MDitor`/`mditor` 그대로 둔다.

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
2. **MD 파서는 서버 하나뿐.** 화면은 MD 를 파싱하지 않고 서버가 되읽은 문서를 받아 연다. 화면에는 직렬화(편집기 → MD)만 있고, 그 출력은 서버와 **바이트 단위로 같다**.
3. **쪽은 화면에서 짐작하지 않는다.** 서버가 PDF 를 그리면서 블록·항목·표 행이 놓인 쪽을 적고, 화면은 쪽 번호가 바뀌는 자리에 경계를 그린다.
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
| `web/src/lib/inline.ts` `table.ts` | 서버와 **같은 규칙** — 고치면 둘 다 고친다 |
| `web/src/lib/rich/` | TipTap 스키마 · 변환(toPM / fromPM) · 명령 |
| `web/src/editor/` | 편집 화면 |
| `web/src/lib/i18n.ts` `i18n/en.ts` | 편집 화면 문구의 언어 — 한국어 원문이 열쇠, 영어 사전 |
| `web/*.html` `web/en/*.html` | 첫 화면 · 편집기 · 문법 · 개발자 · 개인정보처리방침 · 이용약관 (한국어 · 영어) |
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
cd web && npm test            # 화면: 서버와 같은 결과인지(공유 기준 파일), 편집기 명령
cd web && npm run typecheck
node web/e2e/editor.mjs       # 헤드리스 크롬으로 편집 화면 조작(서버가 8011 에 떠 있어야 한다)
```

- **공유 기준 파일** `web/src/lib/rich/fixture.json` 은 서버 테스트가 합성 문서(`tests/synthetic.py`)로 만든다.
  화면 테스트는 `문서 → 편집기 → MD` 가 서버 MD 와 같은지 본다. 문법을 고쳤으면 다시 만든다:
  `MDITOR_WRITE_FIXTURE=1 uv run pytest tests/test_fixture.py`
- `tests/test_render.py::test_layout_matches_the_pdf` 는 PDF 를 다시 읽어, 배치가 말한 쪽에 그 항목·표 행이 실제로 있는지 본다.
- e2e 는 한글 조합 입력(CDP `Input.imeSetComposition`), 칸 끌어 고르기, 워드·엑셀 붙여넣기, 탭 전환, 저장·임시저장, 쪽 경계를 본다.
  실제 OS 입력기(Windows/Edge, macOS/Safari)는 사람이 확인해야 한다.

  ```bash
  PORT=8011 MDITOR_RATE_PER_MINUTE=100000 uv run mditor-server &
  node web/e2e/editor.mjs http://127.0.0.1:8011
  ```

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
| `MDITOR_RATE_PER_MINUTE` | IP 당 분당 요청 수(미리보기·PDF·MCP) |
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
- 환경변수는 Vercel 프로젝트에 둔다(`vercel env add 이름 production`). 지금은 `MDITOR_PUBLIC_URL` 하나다.
- 함수가 여러 개 뜰 수 있다. 횟수 제한은 함수마다 따로 세고, MCP 가 만든 PDF 링크는 만든 함수가 아닌 곳으로 가면 만료로 나올 수 있다.

### 광고

1. AdSense 에 사이트를 등록하고 `ADSENSE_CLIENT` 를 넣는다. 서버가 모든 쪽의 `<head>` 에 AdSense 코드를 넣고 `/ads.txt` 를 만들어 준다.
2. 광고 단위를 둘 만들어 ID 를 `ADSENSE_SLOT_CONTENT`(반응형 디스플레이), `ADSENSE_SLOT_EDITOR`(가로형) 에 넣는다.
   - 내용 쪽: 첫 화면·문법·개발자 쪽의 본문 사이/아래
   - 편집 화면: 맨 아래 띠 하나(편집을 가리지 않는다)
3. AdSense 의 ‘개인 정보 보호 및 메시지’ 에서 동의 메시지(유럽 등)를 켠다.
4. `/privacy` 와 `/terms` 의 운영자 정보를 실제에 맞게 고친다(`web/privacy.html`, `web/terms.html`).

광고 자리는 `?ads=demo` 를 붙이면 볼 수 있다(예: `/edit?ads=demo`).

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
- 문서 편집기 안에는 쪽 경계를 그리지 않는다(오른쪽 미리보기에만 있다).
- 번호 목록·코드 블록·링크 문법은 없다.
- 문서 글꼴은 쪽 설정에서 고른다: Pretendard JP(기본) · 나눔명조 · 나눔고딕 · 나눔손글씨 펜. 모두 SIL OFL 1.1 이다(`src/mditor/fonts/OFL-*.txt`).
  화면은 같은 글꼴의 웹 글꼴(`@fontsource/*`), PDF 는 같은 글꼴 파일로 그린다. 고른 글꼴에 없는 글자(한자 · 기호)는 둘 다 Pretendard 로 채운다.
  이모지는 나오지 않는다.
- 원본 글꼴에는 기울임체가 없어, PDF 의 기울임은 글자를 기울인 사본(`src/mditor/fonts/oblique/`, `scripts/make_oblique.py`)으로 그린다.
  OFL 의 예약된 글꼴 이름 때문에 사본의 이름은 'MDitor Oblique …' 이다. 화면은 브라우저가 기울임을 흉내 낸다(같은 각도).
