"""그림 저장소(R2) — 올리기 · 내주기 · 쪽 배치 · PDF. R2 대신 메모리 저장소로 본다."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader

from mditor import api, images
from mditor.settings import Settings


def png(w=40, h=20, color=(200, 30, 30), alpha=False) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA" if alpha else "RGB", (w, h), color + ((128,) if alpha else ())).save(out, "PNG")
    return out.getvalue()


def jpeg_with_exif(w=30, h=30) -> bytes:
    im = Image.new("RGB", (w, h), (10, 120, 200))
    exif = Image.Exif()
    exif[0x010F] = "카메라 회사"  # Make
    out = io.BytesIO()
    im.save(out, "JPEG", exif=exif)
    return out.getvalue()


def make(tmp_path, store=None, **kw):
    web = tmp_path / "web"
    web.mkdir(exist_ok=True)
    settings = Settings(public_url="https://lasee.test", web_dir=web, cache_dir=tmp_path / "cache", ai_enabled=False, rate_per_minute=1000, **kw)
    return TestClient(api.create_app(settings, store=store))


@pytest.fixture()
def store():
    return images.MemoryStore()


@pytest.fixture()
def client(tmp_path, store):
    with make(tmp_path, store) as c:
        yield c


def upload(client, data, origin="https://lasee.test", **headers):
    return client.post("/api/images", content=data, headers={"Content-Type": "image/png", "Origin": origin, **headers})


def test_config_says_whether_images_go_to_the_store(tmp_path, client):
    cfg = client.get("/api/config").json()
    assert cfg["images"] is True and cfg["maxUploadBytes"] == 3_000_000 and cfg["maxImageFileBytes"] == 10_000_000
    with make(tmp_path) as off:  # R2 설정이 없으면 꺼진다
        assert off.get("/api/config").json()["images"] is False
        assert upload(off, png()).status_code == 404


def test_upload_and_serve(client, store):
    r = upload(client, png(40, 20))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["w"] == 40 and body["h"] == 20 and body["name"].endswith("-40x20.png")
    assert body["url"] == f"https://lasee.test/i/{body['name']}"
    assert body["name"] in store.items
    got = client.get(f"/i/{body['name']}")
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert "immutable" in got.headers["cache-control"] and "s-maxage" in got.headers["cache-control"]
    assert Image.open(io.BytesIO(got.content)).size == (40, 20)
    # 같은 그림은 같은 이름이다(한 번만 쌓인다)
    assert upload(client, png(40, 20)).json()["name"] == body["name"] and len(store.items) == 1


def test_jpeg_stays_jpeg_and_loses_metadata(client, store):
    body = upload(client, jpeg_with_exif(), **{"Content-Type": "image/jpeg"}).json()
    assert body["name"].endswith("-30x30.jpg")
    im = Image.open(io.BytesIO(store.items[body["name"]]))
    assert im.format == "JPEG" and not im.getexif()


def test_transparent_png_keeps_alpha(client, store):
    body = upload(client, png(alpha=True)).json()
    assert Image.open(io.BytesIO(store.items[body["name"]])).mode == "RGBA"


def test_rejects_non_images_big_files_and_other_sites(client, store):
    assert upload(client, b"<html><script>alert(1)</script></html>").status_code == 415
    assert upload(client, b"").status_code == 400
    assert upload(client, b"\x89PNG" + b"0" * 3_000_001).status_code == 413
    huge = io.BytesIO()
    Image.new("L", (4001, 10)).save(huge, "PNG")
    r = upload(client, huge.getvalue())
    assert r.status_code == 415 and "4000" in r.json()["detail"]
    assert upload(client, png(), origin="https://evil.example").status_code == 403
    assert store.items == {}


def test_daily_limit(tmp_path, store):
    with make(tmp_path, store, upload_daily_limit=2) as c:
        assert [upload(c, png(10 + i, 10)).status_code for i in range(3)] == [200, 200, 429]


def test_serve_checks_the_name(client):
    assert client.get("/i/../../etc/passwd").status_code == 404
    assert client.get("/i/" + "0" * 32 + "-1x1.png").status_code == 404  # 없는 그림
    assert client.get("/i/abc.png").status_code == 404


def test_layout_reads_size_from_the_name_and_pdf_draws_the_picture(client, store):
    name = upload(client, png(800, 400)).json()["name"]
    md = f"# 그림 문서\n\n## 1. 그림\n\n![빨간 띠](https://lasee.test/i/{name})\n"
    lay = client.post("/api/md/preview-pages", json={"md": md}).json()
    assert lay["ok"] and lay["layout"]["total"] == 1
    pdf = client.post("/api/md/pdf", json={"md": md})
    assert pdf.status_code == 200
    page = PdfReader(io.BytesIO(pdf.content)).pages[0]
    xobjects = page["/Resources"].get("/XObject") or {}
    assert any(x.get_object()["/Subtype"] == "/Image" for x in xobjects.values()), "그림이 PDF 에 들어간다"
    # 다른 호스트로 적혀 있어도(내려받은 MD 를 다른 곳에서 열어도) 이름으로 이 저장소에서 꺼낸다 — 바깥으로 요청하지 않는다
    assert images.name_of_src(f"http://localhost:8000/i/{name}") == name
    assert images.name_of_src(f"/i/{name}") == name
    assert images.name_of_src("https://example.com/cat.png") is None


def test_missing_picture_still_makes_a_pdf(client):
    md = "# 문서\n\n## 1. 그림\n\n![없음](https://lasee.test/i/" + "a" * 32 + "-100x50.png)\n"
    assert client.post("/api/md/pdf", json={"md": md}).status_code == 200


def test_robots_hides_pictures(client):
    assert "Disallow: /i/" in client.get("/robots.txt").text


def test_dir_store(tmp_path):
    with make(tmp_path, image_dir=str(tmp_path / "pics")) as c:
        assert c.get("/api/config").json()["images"] is True
        name = upload(c, png(12, 34)).json()["name"]
        assert (tmp_path / "pics" / name).is_file()
        assert c.get(f"/i/{name}").status_code == 200
    s = images.DirStore(tmp_path / "pics")
    with pytest.raises(ValueError):
        s.put("../x.png", b"1", "image/png")
    assert s.get("../web") is None

