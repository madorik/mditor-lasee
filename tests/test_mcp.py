"""MCP 서버 — 도구를 직접 부르고, HTTP(/mcp)로도 불러 본다."""

import json

import pytest
from fastapi.testclient import TestClient

from mditor import api, mcp_server
from mditor.settings import Settings, example_md

HEADERS = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}


async def call(server, name, **args):
    result = await server.call_tool(name, args)
    assert not result.is_error, result.content
    return result.structured_content


@pytest.fixture()
def local(tmp_path):
    return mcp_server.build(Settings(public_url="https://mditor.test", cache_dir=tmp_path), remote=False)


async def test_tools_listed(local):
    tools = {t.name: t for t in await local.list_tools()}
    assert set(tools) == {"syntax_guide", "check_markdown", "page_layout", "diff_markdown", "editor_link", "render_pdf"}
    assert all(t.description and len(t.description) > 80 for t in tools.values())


async def test_check_and_normalize(local):
    ok = await call(local, "check_markdown", markdown=example_md())
    assert ok["ok"] and ok["stats"]["tables"] == 4 and "normalized" not in ok
    loose = await call(local, "check_markdown", markdown="#  제목\n* 항목\n")
    assert loose["ok"] and loose["normalized"] == "# 제목\n\n- 항목\n"
    bad = await call(local, "check_markdown", markdown="| a |\n| 1 |\n")
    assert bad["ok"] is False and bad["error"]["line"] == 1


async def test_page_layout_reports_continuations(local):
    rows = "\n".join(f"| {i} | 내용 {i} |" for i in range(1, 120))
    out = await call(local, "page_layout", markdown=f"## 긴 표\n\n### 표\n| 번호 | 내용 |\n|---|---|\n{rows}\n")
    block = out["sections"][0]["blocks"][0]
    assert out["total_pages"] >= 3 and block["page"] == 1 and len(block["continues"]) == out["total_pages"] - 1
    assert [c["page"] for c in block["continues"]] == list(range(2, out["total_pages"] + 1))


async def test_render_pdf_to_file(local, tmp_path):
    target = tmp_path / "out" / "report.pdf"
    missing_dir = await call(local, "render_pdf", markdown=example_md(), output_path=str(target))
    assert missing_dir["ok"] is False
    target.parent.mkdir()
    done = await call(local, "render_pdf", markdown=example_md() + "\n![그림](chart.png)\n", output_path=str(target))
    assert done["ok"] and done["pages"] >= 2 and target.read_bytes().startswith(b"%PDF") and done["missing_images"] == ["chart.png"]
    assert (await call(local, "render_pdf", markdown="글\n", output_path=str(tmp_path / "a.txt")))["ok"] is False


async def test_diff_and_link(local):
    before = example_md()
    after = before.replace("1,840", "1,999")
    d = await call(local, "diff_markdown", before=before, after=after)
    assert [b["label"] for b in d["modified"]] == ["분기별 실적"] and d["new_numbers"] == ["1999"]
    link = await call(local, "editor_link", markdown="# 제목\n\n본문\n")
    assert link["url"].startswith("https://mditor.test/edit#md=")


def test_over_http(tmp_path):
    settings = Settings(public_url="https://mditor.test", web_dir=tmp_path, cache_dir=tmp_path / "cache", ai_enabled=False)
    with TestClient(api.create_app(settings)) as c:
        def rpc(method, params=None, id_=1):
            body = {"jsonrpc": "2.0", "id": id_, "method": method, **({"params": params} if params is not None else {})}
            r = c.post("/mcp", json=body, headers=HEADERS)
            assert r.status_code == 200, r.text
            return r.json()["result"]

        init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
        assert init["serverInfo"]["name"] == "mditor"
        names = [t["name"] for t in rpc("tools/list")["tools"]]
        assert "render_pdf" in names and "output_path" not in json.dumps(rpc("tools/list"))  # 원격에서는 파일을 쓰지 않는다
        out = rpc("tools/call", {"name": "render_pdf", "arguments": {"markdown": example_md(), "filename": "3분기 보고"}})
        result = out["structuredContent"]
        assert result["ok"] and result["pages"] == 2 and result["download_url"].startswith("https://mditor.test/d/")
        pdf = c.get(result["download_url"].removeprefix("https://mditor.test"))
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        res = rpc("resources/read", {"uri": "mditor://syntax"})
        assert "칸 합치기" in res["contents"][0]["text"]
