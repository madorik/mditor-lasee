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
    assert client.get("/edit").status_code == 200
    assert client.get("/assets/a.js").headers["cache-control"].startswith("public, max-age=31536000")
    assert client.get("/ads.txt").text == "google.com, pub-123, DIRECT, f08c47fec0942fa0\n"
    assert "Sitemap: https://mditor.test/sitemap.xml" in client.get("/robots.txt").text
    assert "<loc>https://mditor.test/edit</loc>" in client.get("/sitemap.xml").text
    assert client.get("/../pyproject.toml").status_code == 404 and client.get("/없는쪽").status_code == 404


def test_download_link(client, tmp_path):
    token = core.store_download(tmp_path / "cache", 1800, b"%PDF-1.4 test")
    assert client.get(f"/d/{token}/report.pdf").content == b"%PDF-1.4 test"
    assert client.get("/d/../../etc/passwd").status_code == 404
    assert client.get(f"/d/{'x' * 32}/a.pdf").status_code == 404
