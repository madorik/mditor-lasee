"""영어 태그 · 문서의 태그 언어 · 서버 문구의 언어 · /en 쪽."""

import pytest
from fastapi.testclient import TestClient

from mditor import api, core, i18n, inline, md
from mditor.settings import Settings, example_md

KO = "# 제목\n\n## 1. 가\n\n- {빨강}빨강{/빨강} {밑줄}밑줄{/밑줄}\n\n| a | b |\n|---|---|\n| {음영}1{/음영} | 2 |\n"
EN = KO.replace("빨강}", "red}").replace("밑줄}", "underline}").replace("음영}", "shade}")


# ───────────── 영어 태그 ─────────────


def test_english_tags_mean_the_same():
    assert inline.segments("{red}a{/red} {Underline}b{/UNDERLINE} {shade}c{/shade} {grey}d{/gray}") == inline.segments(
        "{빨강}a{/빨강} {밑줄}b{/밑줄} {음영}c{/음영} {회색}d{/회색}"
    )
    assert inline.segments("{red}a{/빨강}")[0].color == "빨강"  # 이름이 달라도 같은 태그라 짝이 맞는다
    assert inline.segments("{red}짝 없음") == [inline.Seg("{red}짝 없음")]


def test_write_in_each_dialect():
    s = "{빨강}a{/빨강} {blue}b{/blue} {밑줄}{음영}c{/음영}{/밑줄}"
    assert inline.canon(s) == "{빨강}a{/빨강} {파랑}b{/파랑} {밑줄}{음영}c{/음영}{/밑줄}"
    assert inline.canon(s, None, "en") == "{red}a{/red} {blue}b{/blue} {underline}{shade}c{/shade}{/underline}"
    # 글자 그대로의 태그 모양은 어느 언어든 이스케이프한다(읽으면 태그가 되므로)
    assert inline.write([inline.Seg("{red}x{/red}")]) == "\\{red}x\\{/red}"
    assert inline.write([inline.Seg("{빨강}x{/빨강}")], None, "en") == "\\{빨강}x\\{/빨강}"


def test_dialect_of():
    assert inline.dialect_of("글만 있다\n") is None
    assert inline.dialect_of("a {red}b{/red}\n{빨강}c{/빨강}") == "en"
    assert inline.dialect_of("{빨강}c{/빨강}\n{red}b{/red}") == "ko"
    assert inline.dialect_of("{red} 짝 없음\n{밑줄}x{/밑줄}") == "ko"  # 짝 없는 태그는 글자다
    assert inline.dialect_of("\\{red}x\\{/red} {음영}y{/음영}") == "ko"  # 이스케이프한 것도 글자다


def test_document_keeps_its_tag_language():
    assert md.doc_md(md.parse(KO, "en")) == KO  # 문서에 한국어 태그가 있으면 한국어로
    assert md.doc_md(md.parse(EN, "ko")) == EN  # 영어 태그가 있으면 영어로
    mixed = EN.replace("{underline}밑줄{/underline}", "{밑줄}밑줄{/밑줄}")
    assert md.doc_md(md.parse(mixed)) == EN  # 섞이면 처음 나온 태그의 언어로 맞춘다
    plain = "# 제목\n\n- 글\n"
    assert md.doc_md(md.parse(plain, "en")) == plain  # 태그가 없으면 무엇이든 같다
    assert md.parse(EN) == md.parse(EN, "en")


def test_core_read_uses_request_language_for_tagless_documents():
    with i18n.use("en"):
        r = core.read("# T\n\n- a\n")
    assert r["ok"] and r["md"] == "# T\n\n- a\n"
    assert core.read(EN)["md"] == EN and core.read(KO, dialect="en")["md"] == KO


def test_example_documents_read_back_unchanged():
    assert md.doc_md(md.parse(example_md())) == example_md()


# ───────────── 서버 문구 ─────────────


def test_pick_accept_language():
    assert i18n.pick(None) == "ko"
    assert i18n.pick("en") == "en"
    assert i18n.pick("en-US,en;q=0.9,ko;q=0.8") == "en"
    assert i18n.pick("fr-FR, ko;q=0.5, en;q=0.4") == "ko"
    assert i18n.pick("fr, de") == "ko"


def test_messages_follow_the_language():
    assert i18n.t("찾을 수 없습니다.") == "찾을 수 없습니다."
    with i18n.use("en"):
        assert i18n.t("찾을 수 없습니다.") == "Not found."
        assert i18n.t("표는 {max}칸까지 쓸 수 있습니다(지금 {width}칸).", max=40, width=41) == (
            "A table can have up to 40 columns (this one has 41)."
        )
        with pytest.raises(md.MdError) as e:
            md.parse("| a |\n| 1 |\n")
    assert str(e.value).startswith("Line 1: The table has no separator row")


def test_every_message_has_an_english_translation():
    """t("…") 로 감싼 원문은 모두 영어 사전에 있어야 한다."""
    import re
    from pathlib import Path

    used: set[str] = set()
    for path in (Path(__file__).resolve().parents[1] / "src" / "mditor").glob("*.py"):
        used |= set(re.findall(r'\bt\(\s*"((?:[^"\\]|\\.)*)"', path.read_text(encoding="utf-8")))
    assert used, "t() 호출을 찾지 못했다"
    assert sorted(used - set(i18n.EN)) == []


# ───────────── API ─────────────


@pytest.fixture()
def client(tmp_path):
    web = tmp_path / "web"
    (web / "en").mkdir(parents=True)
    for name, body in (("index", "한국어 첫 화면"), ("edit", "편집"), ("404", "없는 쪽")):
        (web / f"{name}.html").write_text(f"<html><head><!--mditor:head--></head><body>{body}</body></html>", encoding="utf-8")
    for name, body in (("index", "English home %PUBLIC_URL%"), ("edit", "Editor"), ("404", "Page not found")):
        (web / "en" / f"{name}.html").write_text(f"<html lang=en><head><!--mditor:head--></head><body>{body}</body></html>", encoding="utf-8")
    settings = Settings(public_url="https://mditor.test", web_dir=web, cache_dir=tmp_path / "cache", ai_enabled=False, rate_per_minute=1000)
    with TestClient(api.create_app(settings)) as c:
        yield c


def test_api_messages_in_english(client):
    bad = {"md": "| a |\n| 1 |\n"}
    ko = client.post("/api/md/preview", json=bad).json()["error"]["message"]
    en = client.post("/api/md/preview", json=bad, headers={"Accept-Language": "en"}).json()["error"]["message"]
    assert "구분선" in ko and en.startswith("The table has no separator row")
    r = client.post("/api/md/pdf", json=bad, headers={"Accept-Language": "en-US,en;q=0.9"})
    assert r.status_code == 422 and r.json()["detail"].startswith("Line 1: The table")
    r = client.post("/api/md/preview", json={"md": "가" * 400_001}, headers={"Accept-Language": "en"})
    assert r.status_code == 413 and r.json()["detail"].startswith("The document is too long (400,001 characters)")
    r = client.post("/api/md/revise", json={"md": "가\n", "instruction": "x"}, headers={"Accept-Language": "en"})
    assert r.status_code == 404 and r.json()["detail"] == "Revise with AI is turned off."


def test_api_english_tags_round_trip(client):
    r = client.post("/api/md/preview", json={"md": EN}).json()
    assert r["ok"] and r["canonical"] and r["md"] == EN
    pdf = client.post("/api/md/pdf", json={"md": EN})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_english_pages(client):
    assert "English home https://mditor.test" in client.get("/en/").text
    assert "English home" in client.get("/en").text
    assert "Editor" in client.get("/en/edit").text
    assert "한국어 첫 화면" in client.get("/").text
    r = client.get("/en/nope")
    assert r.status_code == 404 and "Page not found" in r.text
    r = client.get("/nope")
    assert r.status_code == 404 and "없는 쪽" in r.text
    assert client.get("/en/syntax").status_code == 404  # 파일이 없으면 없는 쪽
    sitemap = client.get("/sitemap.xml").text
    assert "<loc>https://mditor.test/en/</loc>" in sitemap and "<loc>https://mditor.test/en/edit</loc>" in sitemap
