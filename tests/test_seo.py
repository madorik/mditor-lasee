"""검색(SEO) · 답변 엔진(AEO) · AI 검색(GEO) — robots · sitemap · llms.txt · 머리 태그 · 구조화 데이터."""

import html
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mditor import api
from mditor.settings import Settings

WEB = Path(__file__).resolve().parents[1] / "web"
PAGES = ["index", "edit", "syntax", "developers", "privacy", "terms"]
FILES = [WEB / f"{p}.html" for p in PAGES] + [WEB / "en" / f"{p}.html" for p in PAGES]


@pytest.fixture()
def client(tmp_path):
    web = tmp_path / "web"
    (web / "en").mkdir(parents=True)
    for p in PAGES:
        (web / f"{p}.html").write_text("<html><head><!--mditor:head--></head><body></body></html>", encoding="utf-8")
        (web / "en" / f"{p}.html").write_text("<html><head><!--mditor:head--></head><body></body></html>", encoding="utf-8")
    (web / "built.txt").write_text("2026-11-13", encoding="utf-8")
    settings = Settings(
        public_url="https://lasee.test", web_dir=web, cache_dir=tmp_path / "cache", ai_enabled=False,
        site_verification="g-1", naver_site_verification="n-2", bing_site_verification="b-3",
    )
    with TestClient(api.create_app(settings)) as c:
        yield c


def test_robots_names_search_and_ai_crawlers(client):
    text = client.get("/robots.txt").text
    for bot in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Yeti", "Daumoa"):
        assert f"User-agent: {bot}" in text
    assert text.count("Disallow: /api/") == 2 and "Sitemap: https://lasee.test/sitemap.xml" in text


def test_llms_txt(client):
    r = client.get("/llms.txt")
    assert r.status_code == 200 and r.text.startswith("# MDitor LaSee (MDitor 라씨)\n\n> ")
    assert "https://lasee.test/en/syntax" in r.text and "%PUBLIC_URL%" not in r.text
    assert "3 days" in r.text


def test_sitemap_has_language_alternates(client):
    xml = client.get("/sitemap.xml").text
    assert 'xmlns:xhtml="http://www.w3.org/1999/xhtml"' in xml
    assert "<loc>https://lasee.test/en/syntax</loc>" in xml and "<loc>https://lasee.test/</loc>" in xml
    assert '<xhtml:link rel="alternate" hreflang="en" href="https://lasee.test/en/syntax"/>' in xml
    assert xml.count("<lastmod>2026-11-13</lastmod>") == 10  # 빌드한 날(web/built.txt)
    assert xml.count("<url>") == 10 and "/developers" not in xml  # 개발자 안내는 당분간 숨긴다


def test_site_verification_tags(client):
    page = client.get("/").text
    assert 'name="naver-site-verification" content="n-2"' in page and 'name="msvalidate.01" content="b-3"' in page


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(WEB)))
def test_page_head(path):
    s = path.read_text(encoding="utf-8")
    head = s[: s.index("</head>")]
    for need in ('property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"', 'rel="canonical"', 'hreflang="x-default"'):
        assert need in head, need
    lang = "en" if path.parent.name == "en" else "ko"
    assert f"/og-{lang}.png" in head
    assert (WEB / "public" / f"og-{lang}.png").is_file()
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', head, re.DOTALL):
        data = json.loads(block.replace("%PUBLIC_URL%", "https://lasee.test"))
        assert data["@context"] == "https://schema.org"


@pytest.mark.parametrize("path", [WEB / "index.html", WEB / "en" / "index.html"], ids=["ko", "en"])
def test_faq_structured_data_matches_the_page(path):
    s = path.read_text(encoding="utf-8")
    block = re.search(r'<script type="application/ld\+json">(.*?)</script>', s, re.DOTALL).group(1)
    graph = json.loads(block)["@graph"]
    faq = next(g for g in graph if g["@type"] == "FAQPage")
    shown = [html.unescape(re.sub(r"<[^>]+>", "", q)).strip() for q in re.findall(r"<dt>(.*?)</dt>", s, re.DOTALL)]
    assert [q["name"] for q in faq["mainEntity"]] == shown and len(shown) >= 8
    assert any(g["@type"] == "WebApplication" for g in graph)


def test_titles_are_unique():
    titles = [re.search(r"<title>(.*?)</title>", p.read_text(encoding="utf-8")).group(1) for p in FILES]
    assert len(set(titles)) == len(titles)


def test_analytics_only_on_vercel(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("MDITOR_ANALYTICS", raising=False)
    assert Settings().analytics is False  # 로컬 · 도커 · e2e 에는 /_vercel/insights 가 없다
    monkeypatch.setenv("VERCEL", "1")
    assert Settings().analytics is True


def test_developer_guide_is_hidden():
    """개발자 안내 · 'AI 도 같은 글을 고칩니다' 는 당분간 숨긴다 — 링크는 주석 안에만, 쪽은 noindex."""
    for path in FILES:
        if path.name == "developers.html":
            assert 'name="robots" content="noindex"' in path.read_text(encoding="utf-8")
            continue
        visible = re.sub(r"<!--.*?-->", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)
        assert 'href="/developers"' not in visible and 'href="/en/developers"' not in visible, path
        assert "AI 도 같은 글을 고칩니다" not in visible and "AI edits the same text" not in visible, path


def test_llms_full_txt(client):
    """사이트 안내 + 문법 전체를 한 파일로 — AI 답변 엔진이 쪽을 돌아다니지 않고 한 번에 읽는다."""
    r = client.get("/llms-full.txt")
    assert r.status_code == 200 and r.text.startswith("# MDitor LaSee (MDitor 라씨)\n\n> ")
    assert "# MDitor 문서 문법" in r.text and "%PUBLIC_URL%" not in r.text
    assert "https://lasee.test/llms-full.txt" in client.get("/llms.txt").text


def _visible(path):
    return re.sub(r"<!--.*?-->", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(WEB)))
def test_one_h1_per_page(path):
    """쪽의 큰 제목은 하나 — 예시 문서의 제목 같은 것은 h1 로 쓰지 않는다. 편집 쪽은 화면에 안 보이는 h1."""
    assert len(re.findall(r"<h1[\s>]", _visible(path))) == 1


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(WEB)))
def test_description_fits_the_result(path):
    """검색 결과에서 잘리지 않고, 쪽을 설명할 만큼은 되는 길이."""
    s = path.read_text(encoding="utf-8")
    desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', s).group(1))
    limit = 160 if path.parent.name == "en" else 110
    assert 40 <= len(desc) <= limit, (len(desc), desc)
    assert re.search(r'<meta property="og:description" content="([^"]*)"', s).group(1) == re.search(r'<meta name="description" content="([^"]*)"', s).group(1)


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(WEB)))
def test_icons_manifest_and_previews(path):
    head = path.read_text(encoding="utf-8").split("</head>")[0]
    for need in ('href="/favicon.ico"', 'rel="apple-touch-icon" href="/apple-touch-icon.png"', 'rel="manifest" href="/site.webmanifest"'):
        assert need in head, need
    if 'content="noindex"' not in head:
        assert 'name="robots" content="max-image-preview:large"' in head  # 검색 결과 · AI 답변에 큰 미리보기 그림을 써도 된다


def test_icon_files_and_manifest():
    pub = WEB / "public"
    manifest = json.loads((pub / "site.webmanifest").read_text(encoding="utf-8"))
    assert manifest["start_url"] == "/edit" and manifest["short_name"]
    for icon in manifest["icons"]:
        assert (pub / icon["src"].lstrip("/")).is_file(), icon["src"]
    for f in ("favicon.ico", "apple-touch-icon.png"):
        assert (pub / f).is_file(), f
    keys = [p for p in pub.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem)]
    assert len(keys) == 1 and keys[0].read_text().strip() == keys[0].stem  # IndexNow 키(scripts/indexnow.py)


@pytest.mark.parametrize("path", [WEB / "index.html", WEB / "en" / "index.html"], ids=["ko", "en"])
def test_landing_entities(path):
    """운영사(와타랩스 사이트의 Organization 과 같은 @id) · 무료 · 도움말 · npm 패키지(소스 저장소)가 이어져 있다."""
    s = path.read_text(encoding="utf-8")
    block = re.search(r'<script type="application/ld\+json">(.*?)</script>', s, re.DOTALL).group(1)
    assert "<" not in block  # 스크립트 안에 태그처럼 보이는 글자를 두지 않는다
    graph = {g["@type"]: g for g in json.loads(block)["@graph"]}
    org = "https://watalabs.com/#organization"
    assert graph["Organization"]["@id"] == org
    assert graph["WebSite"]["publisher"]["@id"] == org and graph["WebApplication"]["publisher"]["@id"] == org
    app = graph["WebApplication"]
    assert app["isAccessibleForFree"] is True and app["offers"]["price"] == "0" and app["softwareHelp"]["url"].endswith("syntax")
    code = graph["SoftwareSourceCode"]
    assert code["codeRepository"] == "https://github.com/madorik/mditor-lasee" and code["targetProduct"]["@id"] == app["@id"]
