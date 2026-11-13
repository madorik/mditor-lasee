import copy

import pytest

from mditor import md
from mditor.settings import example_md

from .synthetic import MD


def read(text, base=None):
    return md.apply_md(base, text)


def test_roundtrip_is_stable_after_first_read():
    # 첫 왕복은 멱등이 아닐 수 있다(제목만 있는 블록 + 제목 없는 블록이 합쳐짐 등).
    # 그래서 기준은 한 번 되읽은 문서로 잡고, 두 번째 왕복이 같은지 본다.
    doc1 = read(MD)
    md1 = md.doc_md(doc1)
    doc2 = read(md1, doc1)
    assert doc2 == doc1
    assert md.doc_md(doc2) == md1
    assert read(md1) == doc1  # 원본 없이 읽어도 id 가 같다(내용에서 만든다)


def test_example_is_canonical():
    text = example_md()
    assert md.doc_md(read(text)) == text


def test_structure():
    doc = read(MD)
    assert doc["title"] == "합성 문서: **모서리** 모음 {기울임}기울임{/기울임}"  # 제목에도 서식이 들어간다
    assert [s["title"] for s in doc["sections"]] == ["", "1. 글 서식 {빨강}빨간 섹션 머리{/빨강}", "2. 표", "3. 그림과 나머지", ""]
    blocks = {b.get("title") or f"#{i}": b for s in doc["sections"] for i, b in enumerate(s["blocks"])}
    lst = blocks["서식 겹침 **굵은** {밑줄}밑줄{/밑줄} 블록 제목"]
    assert [it["level"] for it in lst["items"]] == [0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0, 0]
    assert lst["notes"] == ["비고 첫 줄 — **굵게**도 된다", "비고 둘째 줄"]
    assert blocks["제목만 있는 블록"] == {
        "id": blocks["제목만 있는 블록"]["id"], "kind": "text", "title": "제목만 있는 블록", "text": "", "notes": [],
    }
    t = blocks["칸 합치기와 정렬"]
    assert len(t["head"]) == 2 and t["align"] == ["left", "left", "center", "right"]
    assert t["rows"][1][1] == "a | b"
    assert t["rows"][4] == ["^", "^", "1.31**", "\\^"]
    odd = blocks["ㄱ자로 어긋난 기호"]
    assert odd["rows"][1] == ["기준", "\\<", "y"] and odd["rows"][2] == ["\\^", "여기는 따로", "z"]
    assert blocks["머리글만 있는 표"]["rows"] == []
    img = blocks["그림"]
    assert (img["src"], img["caption"], img["notes"]) == ("chart.png", "그림 설명 (2026)", ["그림 아래 비고"])


def test_block_grouping():
    doc = read("### 제목\n\n- 가\n- 나\n> 비고\n- 다\n\n문단\n다음 줄\n| a |\n|---|\n| 1 |\n")
    kinds = [(b["kind"], b["title"]) for b in doc["sections"][0]["blocks"]]
    assert kinds == [("list", "제목"), ("list", None), ("text", None), ("text", None), ("table", None)]


def test_lenient_markdown():
    doc = read("# 제목\n\n# 둘째 큰 제목\n\n#### 깊은 제목\n* 별 목록\n+ 더하기 목록\n\n---\n\n1. 번호는 글자\n")
    assert doc["title"] == "제목" and doc["sections"][0]["title"] == "둘째 큰 제목"
    blocks = doc["sections"][0]["blocks"]
    assert blocks[0]["title"] == "깊은 제목" and [i["text"] for i in blocks[0]["items"]] == ["별 목록", "더하기 목록"]
    assert blocks[1]["text"] == "1. 번호는 글자"


@pytest.mark.parametrize(
    "text,line,part",
    [
        ("## 가\n\n| a | b |\n| 1 | 2 |\n", 3, "구분선"),
        ("|---|---|\n| 1 | 2 |\n", 1, "머리글"),
        ("| a | b |\n|---|---|\n| 1 | 2 | 3 |\n", 3, "3칸"),
    ],
)
def test_errors_carry_line(text, line, part):
    with pytest.raises(md.MdError) as e:
        read(text)
    assert e.value.line == line and part in e.value.message


def test_short_rows_are_padded():
    doc = read("| a | b | c |\n|---|---|---|\n| 1 |\n")
    assert doc["sections"][0]["blocks"][0]["rows"] == [["1", "", ""]]


def test_ids_follow_blocks():
    base = read(example_md())
    ids = {b.get("title"): b["id"] for s in base["sections"] for b in s["blocks"]}
    text = example_md()
    # 내용을 고쳐도(제목 같음) · 제목을 고쳐도(내용 비슷) · 섹션을 옮겨도 같은 id
    edited = text.replace("1,840", "1,999").replace("### 문의 유형", "### 문의 유형별 건수")
    doc = read(edited, base)
    new = {b.get("title"): b["id"] for s in doc["sections"] for b in s["blocks"]}
    assert new["분기별 실적"] == ids["분기별 실적"]
    assert new["문의 유형별 건수"] == ids["문의 유형"]
    changes = md.diff(base, doc)
    assert set(changes["modified"]) == {ids["분기별 실적"], ids["문의 유형"]}
    assert changes["added"] == [] and changes["removed"] == []

    added = read(text + "\n### 새 블록\n- 새 항목\n", base)
    changes = md.diff(base, added)
    assert len(changes["added"]) == 1 and changes["modified"] == [] and changes["removed"] == []
    assert changes["added"][0] not in ids.values()

    removed = read(text.replace("### 우선 과제\n- 택배사를 한 곳 더 계약해 배송 지연을 줄인다.\n- 반품 사유를 주문 화면에서 바로 고르게 바꾼다.\n- 전자책 뷰어의 글꼴 설정을 개선한다.\n\n", ""), base)
    changes = md.diff(base, removed)
    assert [r["id"] for r in changes["removed"]] == [ids["우선 과제"]] and changes["added"] == []


def test_untouched_blocks_keep_ids_when_moved():
    base = read("## 가\n\n### 하나\n- a\n\n## 나\n\n### 둘\n- b\n")
    moved = read("## 가\n\n## 나\n\n### 둘\n- b\n\n### 하나\n- a\n", base)
    assert md.diff(base, moved) == {"added": [], "modified": [], "removed": [], "title": False, "sections": False}


def test_deleted_then_restored_block_gets_its_saved_id_back():
    from mditor import core

    text = "## 가\n\n### 하나\n- a\n\n### 둘\n- b\n"
    saved = read(text)
    without = core.read("## 가\n\n### 하나\n- a\n", saved)["doc"]  # 블록 '둘' 을 지운 상태
    restored = core.read(text, saved, without)
    assert restored["doc"] == saved and restored["changes"]["added"] == [] and restored["changes"]["removed"] == []
    typing = core.read(text.replace("- b", "- b 더"), saved, without)  # 직전 문서에 없어도 저장본에서 잇는다
    assert typing["changes"]["modified"] == [saved["sections"][0]["blocks"][1]["id"]]


def test_bad_base_is_ignored():
    doc = read("## 가\n\n- a\n", {"sections": [{"key": 3, "blocks": "x"}]})
    assert doc["sections"][0]["blocks"][0]["id"].startswith("b")
    assert read("## 가\n\n- a\n", "쓰레기") == read("## 가\n\n- a\n")


def test_apply_does_not_mutate_base():
    base = read(example_md())
    snapshot = copy.deepcopy(base)
    read(example_md().replace("문학", "문학·시"), base)
    assert base == snapshot


def test_merge_sections():
    cur = "# 제목\n\n## 1. 가\n\n- a\n\n## 2. 나\n\n문단\n"
    out, touched = md.merge_sections(cur, "<!-- mditor:sections -->\n## 2. 나\n\n고친 문단\n")
    assert out == "# 제목\n\n## 1. 가\n\n- a\n\n## 2. 나\n\n고친 문단\n" and touched == ["2. 나"]
    assert md.merge_sections(cur, "<!-- mditor:sections -->") == (cur, [])
    assert md.merge_sections(cur, "<!-- mditor:full -->\n# 새\n\n본문\n") == ("# 새\n\n본문\n", ["(문서 전체)"])
    assert md.merge_sections(cur, "## 없는 섹션\n\n본문\n")[1] == ["(문서 전체)"]  # 모르는 머리 → 전체로 본다
    assert md.merge_sections(cur, "<!-- mditor:full -->") == (cur, [])


def test_rule_like_text_survives():
    doc = read("\\---\n\n- \\- -\n\n---\n\n***\n")  # 이스케이프한 것은 글자, 그냥 쓴 것은 가로줄(버린다)
    blocks = doc["sections"][0]["blocks"]
    assert [b["kind"] for b in blocks] == ["text", "list"]
    assert blocks[0]["text"] == "\\---" and blocks[1]["items"][0]["text"] == "\\- -"
    assert md.doc_md(doc) == "\\---\n\n- \\- -\n"


def test_new_numbers():
    assert md.new_numbers("매출 1,840 과 12%", "매출 1840, 12.5%, 그리고 2026") == ["12.5", "2026"]
