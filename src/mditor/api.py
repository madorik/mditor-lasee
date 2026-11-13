"""API 서버(FastAPI) — 상태를 두지 않는다. 문서는 사용자의 브라우저에 있고, 서버는 읽고 그리기만 한다.

POST /api/md/preview        MD → 되읽은 문서 · 변경 표시 · 오류 줄   (저장 안 함)
POST /api/md/preview-pages  MD → PDF 를 실제로 그려 본 쪽 배치        (저장 안 함)
POST /api/md/preview-pdf    MD → PDF (iframe 미리보기)
POST /api/md/pdf            MD → PDF (내려받기)
POST /api/md/revise         MD + 지시 → AI 가 고친 MD
POST /api/images            그림 한 장 → 그림 저장소(R2)에 올리고 주소를 준다   (R2 설정이 있을 때만)
GET  /i/<이름>              올린 그림
     /mcp                   MCP(Streamable HTTP) — mcp_server.py
그 밖의 경로는 web/dist 의 정적 사이트.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import time
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import __version__, ai, core, i18n, images, mcp_server
from .i18n import t
from .render import RenderError
from .settings import Settings, llms_txt

PAGES = {"": "index.html", "edit": "edit.html", "syntax": "syntax.html", "developers": "developers.html",
         "privacy": "privacy.html", "terms": "terms.html"}
# 한국어 쪽은 뿌리(/), 다른 언어는 /<언어>/ 아래에 같은 이름으로 있다(web/en/*.html).
PAGE_LANGS = tuple(lang for lang in i18n.LANGS if lang != i18n.DEFAULT)
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
_FETCH_LIMIT = 40_000_000  # PDF 한 번에 저장소에서 꺼내는 그림 합계
# 올린 그림 — 며칠 뒤 지워지므로 오래 담아 두지 않는다(지운 뒤에도 CDN · 브라우저에 오래 남지 않게)
_IMAGE_CACHE = "public, max-age=21600, s-maxage=21600"
# 검색 · AI 답변 엔진 — 모두 같은 규칙으로 허용한다(robots.txt 에 이름을 적어 둔다)
CRAWLERS = (
    "Googlebot", "Bingbot", "Yeti", "Daumoa",  # 구글 · 빙 · 네이버 · 다음
    "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User",
    "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended",
)
log = logging.getLogger("mditor")


class PreviewIn(BaseModel):
    md: str
    base: dict[str, Any] | None = None  # 저장본 — 변경 표시의 기준
    prev: dict[str, Any] | None = None  # 직전에 되읽은 문서 — id 를 잇는 기준


class RenderIn(PreviewIn):
    options: dict[str, Any] | None = None
    images: dict[str, str] | None = None
    image_sizes: dict[str, list[int]] | None = None
    filename: str | None = Field(default=None, max_length=120)


class ReviseIn(PreviewIn):
    instruction: str = Field(max_length=4000)


class _Limiter:
    """IP 당 고정 창 횟수 제한(메모리). 여러 프로세스로 띄우면 프로세스마다 따로 센다."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str, int], int] = defaultdict(int)

    def check(self, key: str, ip: str, limit: int, window: int) -> bool:
        if limit <= 0:
            return True
        slot = int(time.time()) // window
        if len(self._hits) > 50_000:
            self._hits = defaultdict(int, {k: v for k, v in self._hits.items() if k[0] != key or k[2] == slot})
        self._hits[(key, ip, slot)] += 1
        return self._hits[(key, ip, slot)] <= limit


class _Lang:
    """요청의 ``Accept-Language`` 로 이 요청에서 만드는 문구의 언어를 정한다(ASGI)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        header = dict(scope.get("headers") or []).get(b"accept-language", b"").decode("latin-1")
        with i18n.use(i18n.pick(header)):
            await self.app(scope, receive, send)


class _BodyLimit:
    """요청 본문 크기 제한(ASGI)."""

    def __init__(self, app: Any, limit: int) -> None:
        self.app, self.limit = app, limit

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            declared = 0
        seen = 0

        async def limited() -> Any:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body") or b"")
                if seen > self.limit:
                    raise HTTPException(413, t("요청이 너무 큽니다."))
            return message

        if declared > self.limit:
            return await JSONResponse({"detail": t("요청이 너무 큽니다.")}, 413)(scope, receive, send)
        await self.app(scope, limited, send)


def _safe_name(name: str | None, fallback: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", (name or "").strip()).strip(" .")[:80]
    return stem or fallback


def _mb(n: int) -> str:
    return f"{n / 1_000_000:g}"


def create_app(settings: Settings | None = None, store: images.Store | None = None) -> FastAPI:
    """store: 그림 저장소. 주지 않으면 R2 설정이 있을 때 R2 를 쓰고, 없으면 그림 올리기를 끈다."""
    settings = settings or Settings()
    if store is None and settings.r2_enabled:
        store = images.Cached(
            images.R2Store(settings.r2_account_id, settings.r2_access_key_id, settings.r2_secret_access_key, settings.r2_bucket)
        )
    elif store is None and settings.image_dir:
        store = images.DirStore(Path(settings.image_dir), settings.image_ttl_days)
    limiter = _Limiter()
    mcp = mcp_server.build(settings, remote=True)
    mcp_app = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=mcp_server.open_security(),
        host="0.0.0.0",
    )

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> Any:
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title="MDitor LaSee", version=__version__, lifespan=lifespan, docs_url="/api/docs", redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.add_middleware(_BodyLimit, limit=settings.max_body_bytes)
    app.add_middleware(_Lang)  # 바깥쪽 — 본문 한도 문구도 요청 언어로
    app.router.routes.extend(mcp_app.routes)  # /mcp 를 그대로 붙인다(리다이렉트 없이)

    def client_ip(request: Request) -> str:
        if settings.trust_proxy:
            fwd = request.headers.get("x-forwarded-for")
            if fwd:
                return fwd.split(",")[0].strip()
        return request.client.host if request.client else "?"

    def guard(request: Request) -> None:
        if not limiter.check("api", client_ip(request), settings.rate_per_minute, 60):
            raise HTTPException(429, t("요청이 너무 잦습니다. 잠시 뒤에 다시 해 주세요."))

    @app.middleware("http")
    async def headers(request: Request, call_next: Any) -> Any:
        if request.url.path == "/mcp" and not limiter.check("mcp", client_ip(request), settings.rate_per_minute, 60):
            with i18n.use(i18n.pick(request.headers.get("accept-language"))):
                return JSONResponse({"detail": t("요청이 너무 잦습니다. 잠시 뒤에 다시 해 주세요.")}, 429)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    @app.exception_handler(core.InputError)
    async def input_error(_: Request, e: core.InputError) -> JSONResponse:
        return JSONResponse({"detail": str(e)}, 413)

    @app.exception_handler(RenderError)
    async def render_error(_: Request, e: RenderError) -> JSONResponse:
        return JSONResponse({"detail": str(e)}, 422)

    @app.exception_handler(ai.AiError)
    async def ai_error(_: Request, e: ai.AiError) -> JSONResponse:
        return JSONResponse({"detail": str(e)}, e.status)

    def public_config() -> dict[str, Any]:
        return {
            "version": __version__,
            "ai": settings.ai_enabled,
            "aiMaxChars": settings.ai_max_md_chars,
            "maxChars": settings.max_md_chars,
            "maxImageBytes": settings.max_image_bytes,
            "images": store is not None,  # 그림을 저장소에 올린다(아니면 문서와 함께 브라우저에 둔다)
            "maxImageFileBytes": settings.max_image_file_bytes,
            "maxUploadBytes": settings.max_upload_bytes,
            "imageTtlDays": settings.image_ttl_days,  # 올린 그림을 두는 날 수(0 이면 지우지 않는다)
            "publicUrl": settings.public_url,
            "contact": settings.contact_email,
            "analytics": settings.analytics,  # 방문 통계(Vercel Web Analytics)를 넣는다
            "ads": {
                "client": settings.adsense_client,
                "content": settings.adsense_slot_content,
                "editor": settings.adsense_slot_editor,
            },
        }

    # ───────────── API ─────────────

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, Any]:
        return {"ok": True, "version": __version__}

    @app.get("/api/config")
    def config() -> dict[str, Any]:
        return public_config()

    @app.post("/api/md/preview")
    def preview(body: PreviewIn, request: Request) -> dict[str, Any]:
        """MD 를 되읽는다. {ok, doc, md, changes} 또는 {ok: false, error: {line, message}}."""
        guard(request)
        return core.read(core.clean(body.md, settings.max_md_chars), body.base, body.prev)

    def _doc(body: RenderIn) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        result = core.read(core.clean(body.md, settings.max_md_chars), body.base, body.prev)
        return (result["doc"] if result["ok"] else None), result

    @app.post("/api/md/preview-pages")
    def preview_pages(body: RenderIn, request: Request) -> dict[str, Any]:
        """PDF 를 실제로 그려 본 쪽 배치. 그림은 크기(image_sizes)만 받아 자리를 잡는다."""
        guard(request)
        doc, result = _doc(body)
        if doc is None:
            return {"ok": False, "error": result["error"]}
        pics = core.decode_images(body.images, settings.max_image_bytes)
        sizes = {**(body.image_sizes or {}), **images.sizes(doc)}  # 올린 그림은 이름에 크기가 있다
        return {"ok": True, "layout": core.layout(doc, body.options, pics, sizes)}

    def _pdf(body: RenderIn, request: Request, disposition: str) -> Response:
        guard(request)
        doc, result = _doc(body)
        if doc is None:
            err = result["error"]
            raise HTTPException(422, t("{line}번째 줄: {message}", line=err["line"], message=err["message"]))
        pics = core.decode_images(body.images, settings.max_image_bytes)
        try:
            pics.update(images.fetch(doc, store, _FETCH_LIMIT))
        except Exception:
            log.exception("그림 저장소에서 그림을 꺼내지 못했습니다")
        sizes = {**(body.image_sizes or {}), **images.sizes(doc)}
        data, lay = core.pdf(doc, body.options, pics, sizes)
        name = _safe_name(body.filename or doc.get("title"), "문서") + ".pdf"
        return Response(
            data,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
                "X-Mditor-Pages": str(lay["total"]),
                "Cache-Control": "no-store",
            },
        )

    @app.post("/api/md/preview-pdf")
    def preview_pdf(body: RenderIn, request: Request) -> Response:
        return _pdf(body, request, "inline")

    @app.post("/api/md/pdf")
    def download_pdf(body: RenderIn, request: Request) -> Response:
        return _pdf(body, request, "attachment")

    @app.post("/api/md/revise")
    def revise(body: ReviseIn, request: Request) -> dict[str, Any]:
        """AI 수정안. 저장하지 않는다 — 화면이 검토 뒤 적용한다."""
        guard(request)
        if not settings.ai_enabled:
            raise HTTPException(404, t("AI 수정이 꺼져 있습니다."))
        if not limiter.check("ai", client_ip(request), settings.ai_daily_limit, 86_400):
            raise HTTPException(429, t("AI 수정은 하루 {n}번까지 쓸 수 있습니다.", n=settings.ai_daily_limit))
        return ai.revise(settings, core.clean(body.md, settings.max_md_chars), body.instruction, body.base)

    @app.post("/api/images")
    async def upload_image(request: Request) -> dict[str, Any]:
        """그림 한 장(본문 = 그림 파일 바이트)을 저장소에 올린다. {url, name, w, h}."""
        guard(request)
        if store is None:
            raise HTTPException(404, t("그림 올리기가 꺼져 있습니다."))
        origin = (request.headers.get("origin") or "").rstrip("/")
        if origin and settings.public_url and origin != settings.public_url:
            raise HTTPException(403, t("이 사이트의 편집기에서만 그림을 올릴 수 있습니다."))
        data = await request.body()
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, t("그림이 너무 큽니다. 줄여서 한 장에 {mb}MB 까지 올릴 수 있습니다.", mb=_mb(settings.max_upload_bytes)))
        if not data:
            raise HTTPException(400, t("그림 파일을 읽지 못했습니다."))
        if not limiter.check("upload", client_ip(request), settings.upload_daily_limit, 86_400):
            raise HTTPException(429, t("그림은 하루 {n}장까지 올릴 수 있습니다.", n=settings.upload_daily_limit))
        try:
            clean, ext, w, h = await run_in_threadpool(images.normalize, data)
        except images.BadImage as e:
            raise HTTPException(415, str(e)) from e
        name = images.name_for(clean, ext, w, h)
        try:
            await run_in_threadpool(store.put, name, clean, images.MEDIA[ext])
        except Exception as e:
            log.exception("그림 저장소에 올리지 못했습니다")
            raise HTTPException(502, t("그림을 올리지 못했습니다. 잠시 뒤에 다시 해 주세요.")) from e
        return {"url": f"{settings.public_url}/i/{name}", "name": name, "w": w, "h": h}

    @app.get("/i/{name}", include_in_schema=False)
    def image(name: str) -> Response:
        """올린 그림. 며칠 뒤 저장소에서 지워지면 404 가 된다."""
        if store is None or not images.valid_name(name):
            raise HTTPException(404, t("찾을 수 없습니다."))
        try:
            data = store.get(name)
        except Exception as e:
            log.exception("그림 저장소에서 그림을 꺼내지 못했습니다")
            raise HTTPException(502, t("그림을 불러오지 못했습니다.")) from e
        if data is None:
            raise HTTPException(404, t("찾을 수 없습니다."))
        return Response(
            data,
            media_type=images.MEDIA[name.rsplit(".", 1)[1]],
            headers={"Cache-Control": _IMAGE_CACHE, "Content-Security-Policy": "default-src 'none'; sandbox"},
        )

    @app.get("/d/{token}/{name}", include_in_schema=False)
    def download(token: str, name: str) -> Response:
        """MCP 가 만든 PDF 를 잠깐 내려받게 한다(시간이 지나면 지운다)."""
        path = settings.cache_dir / f"{token}.pdf"
        if not _TOKEN.match(token) or not path.is_file() or time.time() - path.stat().st_mtime > settings.download_ttl:
            raise HTTPException(404, t("링크가 만료되었습니다."))
        return FileResponse(path, media_type="application/pdf", filename=_safe_name(name.removesuffix(".pdf"), "문서") + ".pdf")

    # ───────────── 정적 사이트 ─────────────

    web = settings.web_dir
    pages: dict[str, str] = {}

    def render_page(file: str) -> str | None:
        if file not in pages:
            path = web / file
            if not path.is_file():
                return None
            config_json = json.dumps(public_config(), ensure_ascii=False).replace("</", "<\\/")
            head = [f"<script>window.__MDITOR__={config_json}</script>"]
            if settings.site_verification:
                head.append(f'<meta name="google-site-verification" content="{settings.site_verification}">')
            if settings.naver_site_verification:
                head.append(f'<meta name="naver-site-verification" content="{settings.naver_site_verification}">')
            if settings.bing_site_verification:
                head.append(f'<meta name="msvalidate.01" content="{settings.bing_site_verification}">')
            if settings.adsense_client:
                head.append(
                    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='
                    f'{settings.adsense_client}" crossorigin="anonymous"></script>'
                )
            html = path.read_text(encoding="utf-8")
            html = html.replace("<!--mditor:head-->", "\n".join(head))
            pages[file] = html.replace("%PUBLIC_URL%", settings.public_url)
        return pages[file]

    def page(file: str) -> Response:
        html = render_page(file)
        if html is None:
            return PlainTextResponse("웹 화면이 빌드되지 않았습니다. web/ 에서 npm run build 를 실행하세요.", 503)
        return HTMLResponse(html, headers={"Cache-Control": "no-cache"})

    @app.get("/ads.txt", include_in_schema=False)
    def ads_txt() -> Response:
        if not settings.adsense_client:
            raise HTTPException(404)
        pub = settings.adsense_client.removeprefix("ca-")
        return PlainTextResponse(f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n")

    @app.get("/robots.txt", include_in_schema=False)
    def robots() -> Response:
        rules = ["Allow: /", "Disallow: /api/", "Disallow: /d/", "Disallow: /i/", "Disallow: /mcp"]
        lines = ["User-agent: *", *rules, "", "# 검색 · AI 답변 엔진", *(f"User-agent: {c}" for c in CRAWLERS), *rules]
        if settings.public_url:
            lines += ["", f"Sitemap: {settings.public_url}/sitemap.xml"]
        return PlainTextResponse("\n".join(lines) + "\n")

    @app.get("/llms.txt", include_in_schema=False)
    def llms() -> Response:
        """AI 검색 · 답변 엔진이 읽는 사이트 안내(llmstxt.org)."""
        return PlainTextResponse(llms_txt(settings.public_url), headers={"Cache-Control": "public, max-age=3600"})

    def page_file(key: str) -> str | None:
        """주소(앞뒤 / 없이) → web 안의 HTML 파일. 쪽이 아니면 None."""
        if key in PAGES:
            return PAGES[key]
        head, _, rest = key.partition("/")
        if head in PAGE_LANGS and rest in PAGES:
            return f"{head}/{PAGES[rest]}"
        for prefix in ("", *(f"{lang}/" for lang in PAGE_LANGS)):  # /syntax.html · /en/syntax.html
            if key.startswith(prefix) and key[len(prefix) :] in PAGES.values():
                return key
        return None

    @app.get("/sitemap.xml", include_in_schema=False)
    def sitemap() -> Response:
        """쪽마다 언어별 대안 주소(hreflang)와 고친 날(빌드한 날)을 함께 싣는다."""
        base = settings.public_url

        def loc(lang: str, key: str) -> str:
            pre = "" if lang == i18n.DEFAULT else f"{lang}/"
            return f"{base}/{pre}{key}" if key else f"{base}/{pre}"

        # 고친 날 = 화면을 빌드한 날(web/built.txt). 배포 환경은 파일 시각을 고정값으로 바꾸므로 파일 시각은 쓰지 않는다
        built = web / "built.txt"
        mod = built.read_text(encoding="utf-8").strip() if built.is_file() else ""
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", mod):
            mod = ""

        urls = []
        for key in PAGES:
            alts = "".join(f'<xhtml:link rel="alternate" hreflang="{lang}" href="{loc(lang, key)}"/>' for lang in i18n.LANGS)
            alts += f'<xhtml:link rel="alternate" hreflang="x-default" href="{loc(i18n.DEFAULT, key)}"/>'
            for lang in i18n.LANGS:
                urls.append(f"<url><loc>{loc(lang, key)}</loc>{f'<lastmod>{mod}</lastmod>' if mod else ''}{alts}</url>")
        return Response(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
            + "".join(urls) + "</urlset>",
            media_type="application/xml",
        )

    if (web / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=web / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def site(path: str) -> Response:
        key = path.strip("/")
        file_name = page_file(key)
        if file_name and (web / file_name).is_file():
            return page(file_name)
        file = (web / key).resolve()
        if key and file.is_file() and web.resolve() in file.parents:
            return FileResponse(file)
        head = key.partition("/")[0]
        lang = head if head in PAGE_LANGS else i18n.DEFAULT
        html = render_page(f"{lang}/404.html" if lang != i18n.DEFAULT else "404.html") or render_page("404.html")
        with i18n.use(lang):
            return HTMLResponse(html, 404) if html else PlainTextResponse(t("찾을 수 없습니다."), 404)

    @app.middleware("http")
    async def cache_assets(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        if request.url.path.startswith("/assets/") and response.status_code == 200:
            # s-maxage: 앞단 CDN(Vercel 등)도 담아 두게 한다 — 이름에 내용 해시가 붙어 있어 바뀌지 않는다
            response.headers["Cache-Control"] = "public, max-age=31536000, s-maxage=31536000, immutable"
        return response

    return app


def app_factory() -> FastAPI:
    return create_app()


def main() -> None:
    import uvicorn

    uvicorn.run(
        "mditor.api:app_factory",
        factory=True,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        workers=int(os.environ.get("WEB_CONCURRENCY", "1")),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
