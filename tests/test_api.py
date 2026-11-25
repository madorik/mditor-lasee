import json

import pytest
from fastapi.testclient import TestClient

from mditor import api, core
from mditor.settings import Settings, example_md


@pytest.fixture()
def client(tmp_path):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<html><head><!--mditor:head--></head><body>첫 화면 %PUBLIC_URL%</body></html>", encoding="utf-8")
    (web / "edit.html").write_text("<html><head><!--mditor:head--></head><body>편집</body></html>", encoding="utf-8")
    (web / "assets" / "a.js").write_text("1", encoding="utf-8")
    settings = Settings(
        public_url="https://mditor.test", web_dir=web, cache_dir=tmp_path / "cache", ai_enabled=False,
        adsense_client="ca-pub-123", adsense_slot_content="111", rate_per_minute=1000,
    )
    with TestClient(api.create_app(settings)) as c:
        yield c


def test_preview_ok_and_error(client):
    r = client.post("/api/md/preview", json={"md": example_md()}).json()
    assert r["ok"] and r["canonical"] and r["md"] == example_md() and r["changes"] is None
    assert r["doc"]["title"].startswith("2026년")
    bad = client.post("/api/md/preview", json={"md": "| a |\n| 1 |\n"}).json()
    assert bad == {"ok": False, "error": {"line": 1, "message": bad["error"]["message"]}} and "구분선" in bad["error"]["message"]


def test_preview_changes_against_base(client):
    base = client.post("/api/md/preview", json={"md": example_md()}).json()["doc"]
    r = client.post("/api/md/preview", json={"md": example_md().replace("1,840", "1,999"), "base": base}).json()
    assert len(r["changes"]["modified"]) == 1 and r["changes"]["added"] == []


def test_pages_and_pdf(client):
    r = client.post("/api/md/preview-pages", json={"md": example_md(), "options": {"font_size": 10.5}}).json()
    assert r["ok"] and r["layout"]["total"] == 2
    assert client.post("/api/md/preview-pages", json={"md": "| a |\n| 1 |\n"}).json()["ok"] is False
    pdf = client.post("/api/md/pdf", json={"md": example_md(), "filename": "보고서"})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["x-mditor-pages"] == "2"
    assert "attachment" in pdf.headers["content-disposition"] and "%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf" in pdf.headers["content-disposition"]
    assert "inline" in client.post("/api/md/preview-pdf", json={"md": "문단\n"}).headers["content-disposition"]
    assert client.post("/api/md/pdf", json={"md": "| a |\n| 1 |\n"}).status_code == 422


def test_limits(client):
    assert client.post("/api/md/preview", json={"md": "가" * 400_001}).status_code == 413
    huge = "data:image/png;base64," + "A" * 12_000_000
    assert client.post("/api/md/pdf", json={"md": "문단\n", "images": {"a.png": huge}}).status_code == 413


def test_rate_limit(tmp_path):
    settings = Settings(web_dir=tmp_path, cache_dir=tmp_path, rate_per_minute=3, ai_enabled=False)
    with TestClient(api.create_app(settings)) as c:
        codes = [c.post("/api/md/preview", json={"md": "가\n"}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_revise_is_off_without_key(client):
    assert client.post("/api/md/revise", json={"md": "가\n", "instruction": "다듬어"}).status_code == 404
    assert client.get("/api/config").json()["ai"] is False


def test_site_pages(client):
    home = client.get("/")
    assert home.status_code == 200 and "첫 화면 https://mditor.test" in home.text
    assert "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123" in home.text
    cfg = json.loads(home.text.split("window.__MDITOR__=")[1].split("</script>")[0])
    assert cfg["ads"] == {"client": "ca-pub-123", "content": "111", "editor": ""} and cfg["publicUrl"] == "https://mditor.test"
    assert cfg["maxPasteChars"] == 5000  # 한 번에 붙여 넣는 글 한도(화면이 지킨다)
    edit = client.get("/edit")
    assert edit.status_code == 200
    # 편집 화면은 광고 코드를 쪽이 뜬 뒤에 받는다(편집기가 먼저)
    assert '<script async src="https://pagead2' not in edit.text and 'addEventListener("load"' in edit.text and "adsbygoogle.js?client=ca-pub-123" in edit.text
    assert client.get("/assets/a.js").headers["cache-control"].startswith("public, max-age=31536000")
    assert client.get("/ads.txt").text == "google.com, pub-123, DIRECT, f08c47fec0942fa0\n"
    assert "Sitemap: https://mditor.test/sitemap.xml" in client.get("/robots.txt").text
    assert "<loc>https://mditor.test/edit</loc>" in client.get("/sitemap.xml").text
    assert client.get("/../pyproject.toml").status_code == 404 and client.get("/없는쪽").status_code == 404


def test_static_pages_are_cached_by_the_cdn_only(client):
    """화면 · robots · sitemap 은 파이썬 함수를 매번 깨우지 않게 Vercel CDN 에만 담는다. 브라우저는 계속 다시 확인하고, API 는 담지 않는다."""
    cdn = "Vercel-CDN-Cache-Control"
    for path in ("/", "/edit", "/robots.txt", "/sitemap.xml", "/llms.txt", "/ads.txt"):
        r = client.get(path)
        assert r.status_code == 200 and r.headers[cdn].startswith("max-age="), path
    assert client.get("/").headers["cache-control"] == "no-cache"  # 브라우저는 그대로 다시 확인
    assert cdn not in client.get("/없는쪽").headers  # 없는 쪽(404)은 담지 않는다
    assert cdn not in client.get("/api/config").headers
    assert cdn not in client.post("/api/md/preview", json={"md": "# a"}).headers


def test_download_link(client, tmp_path):
    token = core.store_download(tmp_path / "cache", 1800, b"%PDF-1.4 test")
    assert client.get(f"/d/{token}/report.pdf").content == b"%PDF-1.4 test"
    assert client.get("/d/../../etc/passwd").status_code == 404
    assert client.get(f"/d/{'x' * 32}/a.pdf").status_code == 404


# ───────────── 큰 문서 · 붙여넣기에 버티기 ─────────────


def test_latest_turn_skips_superseded_requests():
    """같은 열쇠의 요청은 하나씩, 차례가 왔을 때 더 새 요청이 와 있으면 건너뛴다."""
    import threading
    import time

    latest = api._Latest()
    order: list[tuple[str, bool]] = []
    first_in = threading.Event()

    def run(name: str, hold: float = 0.0) -> None:
        with latest.turn("pages", "c:tab") as mine:
            if name == "a":
                first_in.set()
            order.append((name, mine))
            time.sleep(hold)

    a = threading.Thread(target=run, args=("a", 0.3))
    a.start()
    first_in.wait(2)
    b = threading.Thread(target=run, args=("b",))
    b.start()
    time.sleep(0.05)
    c = threading.Thread(target=run, args=("c",))
    c.start()
    for th in (a, b, c):
        th.join(5)
    assert order[0] == ("a", True)
    assert sorted(order[1:]) == [("b", False), ("c", True)]  # b 는 c 에 밀려 하지 않는다
    with latest.turn("pages", "c:other") as mine:
        assert mine  # 다른 탭은 따로 줄을 선다


def test_live_layout_budget_counts_characters(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    settings = Settings(web_dir=web, cache_dir=tmp_path, ai_enabled=False, rate_per_minute=1000, live_render_chars_per_minute=30_000)
    big = "# 큰 문서\n\n" + "\n\n".join(f"문단 {i} " + "가" * 90 for i in range(120)) + "\n"  # 약 1만 2천 자
    with TestClient(api.create_app(settings)) as c:
        live = {"X-Mditor-Client": "tab-0001"}
        codes = [c.post("/api/md/preview-pages", json={"md": big, "live": True}, headers=live).status_code for _ in range(4)]
        assert codes == [200, 200, 429, 429]  # 분당 3만 자 — 두 번까지
        assert "쪽 계산을 잠시 쉽니다" in c.post("/api/md/preview-pages", json={"md": big, "live": True}, headers=live).json()["detail"]
        other = c.post("/api/md/preview-pages", json={"md": big, "live": True}, headers={"X-Mditor-Client": "tab-0002"})
        assert other.status_code == 200  # 다른 탭(같은 IP 의 다른 사람)은 따로 센다
        assert c.post("/api/md/preview-pages", json={"md": big}, headers=live).status_code == 200  # 저절로 간 요청이 아니면 세지 않는다
        assert c.post("/api/md/pdf", json={"md": big}, headers=live).status_code == 200  # 내려받기는 막지 않는다


def test_too_long_document_is_refused_before_any_work(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    settings = Settings(web_dir=web, cache_dir=tmp_path, ai_enabled=False, rate_per_minute=1000, max_md_chars=1000)
    with TestClient(api.create_app(settings)) as c:
        for path in ("/api/md/preview", "/api/md/preview-pages", "/api/md/preview-pdf"):
            r = c.post(path, json={"md": "가" * 1001, "live": True})
            assert r.status_code == 413 and "1,000자까지" in r.json()["detail"], path


def _gz(body: dict) -> bytes:
    import gzip

    return gzip.compress(json.dumps(body, ensure_ascii=False).encode())


GZ = {"Content-Type": "application/json", "Content-Encoding": "gzip"}


def test_gzip_request_body(client):
    """화면은 큰 요청을 gzip 으로 줄여 보낸다 — 풀어서 그대로 처리한다."""
    plain = client.post("/api/md/preview", json={"md": example_md()}).json()
    packed = client.post("/api/md/preview", content=_gz({"md": example_md()}), headers=GZ)
    assert packed.status_code == 200 and packed.json() == plain
    pages = client.post("/api/md/preview-pages", content=_gz({"md": example_md(), "live": True}), headers=GZ).json()
    assert pages["ok"] and pages["layout"]["total"] == 2
    bad = client.post("/api/md/preview", content=b"not gzip", headers=GZ)
    assert bad.status_code == 400
    cut = client.post("/api/md/preview", content=_gz({"md": example_md()})[:-12], headers=GZ)  # 끝이 잘린 본문
    assert cut.status_code == 400


def test_gzip_bomb_is_rejected(tmp_path):
    """작게 줄인 본문도 풀린 크기가 한도를 넘으면 받지 않는다."""
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html><head><!--mditor:head--></head><body></body></html>", encoding="utf-8")
    settings = Settings(public_url="https://mditor.test", web_dir=web, cache_dir=tmp_path / "c", ai_enabled=False, max_body_bytes=200_000)
    with TestClient(api.create_app(settings)) as c:
        body = _gz({"md": "가" * 50_000 + "\n" + " " * 1_000_000})
        assert len(body) < 20_000
        r = c.post("/api/md/preview", content=body, headers=GZ)
        assert r.status_code == 413
