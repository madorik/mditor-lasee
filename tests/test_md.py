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
    assert [s["title"] for s in doc["sections"]] == [
        "", "1. 글 서식 {빨강}빨간 섹션 머리{/빨강}", "2. 표", "3. 그림과 나머지", "4. 링크 · 코드 · 형광펜 · 첨자",
        "5. 목록 · 코드 블록 · 가로줄 · 쪽 나눔 · 정렬", "",
    ]
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
    assert doc["dialect"] == "ko"
    img = blocks["그림"]
    assert (img["src"], img["caption"], img["notes"]) == ("chart.png", "그림 설명 (2026)", ["그림 아래 비고"])


def test_block_grouping():
    doc = read("### 제목\n\n- 가\n- 나\n> 비고\n- 다\n\n문단\n다음 줄\n| a |\n|---|\n| 1 |\n")
    kinds = [(b["kind"], b["title"]) for b in doc["sections"][0]["blocks"]]
    assert kinds == [("list", "제목"), ("list", None), ("text", None), ("text", None), ("table", None)]


def test_lenient_markdown():
    doc = read("# 제목\n\n# 둘째 큰 제목\n\n#### 깊은 제목\n* 별 목록\n+ 더하기 목록\n\n---\n\n1. 번호 목록\n")
    assert doc["title"] == "제목" and doc["sections"][0]["title"] == "둘째 큰 제목"
    blocks = doc["sections"][0]["blocks"]
    assert blocks[0]["title"] == "깊은 제목" and [i["text"] for i in blocks[0]["items"]] == ["별 목록", "더하기 목록"]
    assert blocks[1]["kind"] == "rule"
    assert blocks[2]["items"] == [{"text": "번호 목록", "level": 0, "ordered": True}]


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
    doc = read("\\---\n\n- \\- -\n\n---\n\n***\n")  # 이스케이프한 것은 글자, 그냥 쓴 것은 가로줄
    blocks = doc["sections"][0]["blocks"]
    assert [b["kind"] for b in blocks] == ["text", "list", "rule", "rule"]
    assert blocks[0]["text"] == "\\---" and blocks[1]["items"][0]["text"] == "\\- -"
    assert md.doc_md(doc) == "\\---\n\n- \\- -\n\n---\n\n---\n"


def test_new_numbers():
    assert md.new_numbers("매출 1,840 과 12%", "매출 1840, 12.5%, 그리고 2026") == ["12.5", "2026"]


# ───────────── 번호 · 할 일 · 코드 · 가로줄 · 쪽 나눔 · 정렬 ─────────────


def blocks_of(text, dialect=None):
    return [{k: v for k, v in b.items() if k != "id"} for s in md.parse(text, dialect)["sections"] for b in s["blocks"]]


def test_ordered_and_task_items():
    (block,) = blocks_of(
        "1. 하나\n2. 둘\n   - 둘 아래 글머리\n     1. 더 아래 번호\n3. 셋\n- [ ] 할 일\n- [x] 끝낸 일\n7. 일곱부터\n8. 여덟\n"
    )
    assert block["items"] == [
        {"text": "하나", "level": 0, "ordered": True},
        {"text": "둘", "level": 0, "ordered": True},
        {"text": "둘 아래 글머리", "level": 1},
        {"text": "더 아래 번호", "level": 2, "ordered": True},
        {"text": "셋", "level": 0, "ordered": True},
        {"text": "할 일", "level": 0, "checked": False},
        {"text": "끝낸 일", "level": 0, "checked": True},
        {"text": "일곱부터", "level": 0, "ordered": True, "start": 7},
        {"text": "여덟", "level": 0, "ordered": True},
    ]
    out = md.doc_md(md.parse("1. 하나\n2. 둘\n   - 둘 아래\n     1. 아래 번호\n3. 셋\n- [ ] 할 일\n- [x] 끝\n7. 일곱\n8. 여덟\n"))
    assert out == "1. 하나\n2. 둘\n   - 둘 아래\n     1. 아래 번호\n3. 셋\n- [ ] 할 일\n- [x] 끝\n7. 일곱\n8. 여덟\n"
    # N) 도 번호, 번호는 처음 번호부터 이어 센다(쓸 때 다시 매긴다)
    assert md.doc_md(md.parse("5) a\n9) b\n0) c\n")) == "5. a\n6. b\n7. c\n"
    assert blocks_of("0. a\n1. b\n")[0]["items"][0] == {"text": "a", "level": 0, "ordered": True, "start": 0}
    assert blocks_of("1. [ ] a\n- [ ]\n- [x]x\n-\n1.\n")[0]["items"] == [{"text": "a", "level": 0, "ordered": True, "checked": False}, {"text": "[x]x", "level": 0}]


def test_item_levels_follow_content_columns():
    def levels(text):
        return [it["level"] for it in blocks_of(text)[0]["items"]]

    assert levels("- a\n  - b\n    - c\n      - d\n        - e\n") == [0, 1, 2, 3, 3]  # 3단계까지
    assert levels("- a\n    - b\n        - c\n") == [0, 1, 2]  # 4칸 들여쓰기
    assert levels("- a\n - b\n  - c\n   - d\n") == [0, 0, 0, 0]  # 앞 항목의 글 시작 칸에 못 미치면 같은 단계다
    assert levels("- a\n   - b\n") == [0, 1]
    assert levels("1. a\n  1. b\n") == [0, 0] and levels("1. a\n   1. b\n") == [0, 1]  # `1. ` 아래는 세 칸부터 자식
    assert levels("  - a\n- b\n") == [0, 0]
    assert levels("- a\n\t- b\n") == [0, 1]
    # 쓸 때는 부모의 글 시작 칸에 맞춘다
    assert md.doc_md(md.parse("9. a\n   10. b\n       - c\n")) == "9. a\n   10. b\n       - c\n"


def test_code_blocks():
    (code,) = blocks_of("```py title=x\ndef f():\n    return 1\n\n\n```\n")
    assert code == {"kind": "code", "title": None, "lang": "py", "code": "def f():\n    return 1", "notes": []}
    assert blocks_of("```\nunclosed\n## 이것도 코드\n")[0]["code"] == "unclosed\n## 이것도 코드"  # 닫지 않으면 끝까지
    assert blocks_of("````\n```\ninner\n```\n````\n")[0]["code"] == "```\ninner\n```"
    assert blocks_of("  ```\n  들여쓴 코드\n    더\n  ```\n")[0]["code"] == "들여쓴 코드\n  더"
    assert [b["kind"] for b in blocks_of("    ```\nx\n")] == ["text", "text"]  # 네 칸 들여쓴 울타리는 울타리가 아니다
    assert blocks_of("``` a`b\n")[0]["kind"] == "text"  # 안내 글에 백틱이 있으면 울타리가 아니다
    assert md.doc_md(md.parse('```py\nx = "```"\n```\n')) == '````py\nx = "```"\n````\n'  # 울타리는 코드 안의 백틱보다 길다
    assert md.doc_md(md.parse("```\n```\n")) == "```\n```\n"
    assert blocks_of("### 제목\n```\nx\n```\n> 비고\n")[0] == {
        "kind": "code", "title": "제목", "lang": "", "code": "x", "notes": ["비고"],
    }


def test_code_fence_hides_headings():
    doc = md.parse("# T\n\n## 가\n\n```\n## 코드 안\n# 코드 안 제목\n```\n\n## 나\n")
    assert doc["title"] == "T" and [s["title"] for s in doc["sections"]] == ["가", "나"]
    assert doc["sections"][0]["blocks"][0]["code"] == "## 코드 안\n# 코드 안 제목"
    lead, parts = md._split_sections("앞\n```\n## x\n```\n## 가\n본문\n## 나\n")
    assert lead == ["앞", "```", "## x", "```"] and [h for h, _ in parts] == ["## 가", "## 나"]
    cur = "## 가\n\n```\n## 가짜\n```\n\n## 나\n\n문단\n"
    out, touched = md.merge_sections(cur, "<!-- mditor:sections -->\n## 나\n\n고침\n")
    assert out == "## 가\n\n```\n## 가짜\n```\n\n## 나\n\n고침\n" and touched == ["나"]


def test_rule_and_pagebreak():
    kinds = [b["kind"] for b in blocks_of("---\n\n***\n\n___\n\n- - -\n\n<!-- pagebreak -->\n\n<!--PageBreak-->\n")]
    assert kinds == ["rule"] * 4 + ["pagebreak"] * 2
    assert blocks_of("<!-- pagebreak --> x\n")[0]["kind"] == "text"
    assert md.doc_md(md.parse("***\n\n<!--  PAGEBREAK -->\n")) == "---\n\n<!-- pagebreak -->\n"
    assert blocks_of("### 제목\n---\n> 비고\n") == [{"kind": "rule", "title": "제목", "notes": ["비고"]}]
    for text in ("\\---", "\\___", "\\<!-- pagebreak -->"):  # 이스케이프한 것은 글자
        assert blocks_of(text + "\n")[0]["kind"] == "text"
        assert md.doc_md(md.parse(text + "\n")) == text + "\n"


def test_paragraph_alignment():
    texts = {
        "{가운데}가운데 **굵게**{/가운데}": ("가운데 **굵게**", "center"),
        "{오른쪽}a{/오른쪽}": ("a", "right"),
        "{양쪽}a{/양쪽}": ("a", "justify"),
    }
    for src, (text, align) in texts.items():
        assert blocks_of(src + "\n")[0] == {"kind": "text", "title": None, "text": text, "notes": [], "align": align}
    assert "align" not in blocks_of("{왼쪽}a{/왼쪽}\n")[0]
    assert blocks_of("a {가운데}b{/가운데}\n")[0]["text"] == "a b" and "align" not in blocks_of("a {가운데}b{/가운데}\n")[0]
    assert blocks_of("{가운데}{/가운데}\n") == []  # 빈 문단은 버린다
    # 문서의 태그 언어로 쓴다
    assert md.doc_md(md.parse("{center}a{/center}\n")) == "{center}a{/center}\n"
    assert md.doc_md(md.parse("{가운데}a{/가운데}\n", "en")) == "{가운데}a{/가운데}\n"
    assert md.doc_md(md.parse("{가운데}a{/가운데}\n{red}b{/red}\n")) == "{가운데}a{/가운데}\n\n{빨강}b{/빨강}\n"  # 섞이면 처음 나온 태그의 언어로
    assert md.parse("{가운데}a{/가운데}\n")["dialect"] == "ko" and md.parse("{center}a{/center}\n")["dialect"] == "en"
    assert md.parse("글\n", "en")["dialect"] == "en" and md.parse("글\n")["dialect"] == "ko"
    # 문서에 태그 언어가 없고 정렬 문단이 doc.dialect 로 쓰인다
    doc = md.parse("a\n")
    doc["sections"][0]["blocks"][0]["align"] = "center"
    assert md.doc_md(doc) == "{가운데}a{/가운데}\n" and md.doc_md({**doc, "dialect": "en"}) == "{center}a{/center}\n"
    assert md.doc_md(doc, "en") == "{center}a{/center}\n"


def test_block_symbol_paragraphs_survive_a_roundtrip():
    for para in ["1. 개요", "2026) 연도", "<!-- pagebreak -->", "___", "{가운데}글자{/가운데}", "[ ] 칸", "- 목록", "# 제목", "```"]:
        doc = {
            "title": "", "dialect": "ko",
            "sections": [{"key": "s", "title": "", "blocks": [
                {"id": "b", "kind": "text", "title": None, "text": inline_canon(para), "notes": []},
            ]}],
        }
        out = md.doc_md(doc)
        again = md.parse(out)
        assert again["sections"][0]["blocks"][0]["kind"] == "text", out
        assert md.doc_md(again) == out


def inline_canon(para):
    from mditor import inline

    return inline.canon(para.replace("{", "\\{"), "para")


def test_ids_with_new_kinds():
    text = "## 가\n\n```py\nx\n```\n\n---\n\n<!-- pagebreak -->\n\n1. 하나\n2. 둘\n"
    base = read(text)
    assert [b["kind"] for b in base["sections"][0]["blocks"]] == ["code", "rule", "pagebreak", "list"]
    ids = [b["id"] for b in base["sections"][0]["blocks"]]
    assert len(set(ids)) == 4
    again = read(text.replace("x", "y"), base)  # 코드 안을 고치면 같은 id, 고친 것으로 본다
    assert [b["id"] for b in again["sections"][0]["blocks"]] == ids
    assert md.diff(base, again)["modified"] == [ids[0]]
    removed = read(text.replace("---\n\n", ""), base)
    assert [r["id"] for r in md.diff(base, removed)["removed"]] == [ids[1]]
    assert md.diff(base, removed)["removed"][0]["label"] == "가로줄"
    out = md.outline(base)[0]["blocks"]
    assert out[0]["label"] == "x" and out[0]["lines"] == 1 and out[0]["lang"] == "py" and out[3]["items"] == 2
    assert md.outline(base)[0]["blocks"][2]["label"] == "쪽 나눔"
    # 번호 · 할 일이 바뀌어도 고친 것으로 본다
    edited = read(text.replace("2. 둘", "2. [x] 둘"), base)
    assert md.diff(base, edited)["modified"] == [ids[3]]
