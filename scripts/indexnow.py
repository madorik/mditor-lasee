"""배포한 뒤 sitemap 의 주소를 IndexNow 로 알린다 — Bing · 네이버 · Yandex 등이 바뀐 쪽을 빨리 다시 읽는다.

    uv run python scripts/indexnow.py [https://lasee.watalabs.com]

키는 web/public/<키>.txt 다(사이트 뿌리에 그대로 나간다). 키를 바꾸면 그 파일도 바꾼다.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / "web" / "public"


def key() -> str:
    found = [p.stem for p in PUBLIC.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem)]
    if len(found) != 1:
        raise SystemExit(f"web/public 에 IndexNow 키 파일이 하나 있어야 합니다(지금 {len(found)}개)")
    return found[0]


def main() -> None:
    base = (sys.argv[1] if len(sys.argv) > 1 else "https://lasee.watalabs.com").rstrip("/")
    k = key()
    with urllib.request.urlopen(f"{base}/{k}.txt", timeout=20) as r:  # 키 파일이 배포돼 있어야 받아 준다
        if r.read().decode().strip() != k:
            raise SystemExit("배포된 키 파일 내용이 다릅니다")
    with urllib.request.urlopen(f"{base}/sitemap.xml", timeout=20) as r:
        urls = re.findall(r"<loc>([^<]+)</loc>", r.read().decode())
    host = re.sub(r"^https?://", "", base)
    body = json.dumps({"host": host, "key": k, "keyLocation": f"{base}/{k}.txt", "urlList": urls}).encode()
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow", data=body, method="POST", headers={"Content-Type": "application/json; charset=utf-8"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"IndexNow {r.status}: 주소 {len(urls)}개를 알렸습니다")


if __name__ == "__main__":
    main()
