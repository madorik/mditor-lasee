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
    assert xml.count("<lastmod>2026-11-13</lastmod>") == 12  # 빌드한 날(web/built.txt)
    assert xml.count("<url>") == 12


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
