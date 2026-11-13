"""Vercel 진입점 — Vercel 은 이 파일의 `app`(FastAPI)을 함수 하나로 띄운다.

로컬·도커는 이 파일을 쓰지 않는다(`mditor-server`). 배포 설정은 vercel.json.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))  # 설치본이 아니라 이 저장소의 src 를 쓴다
os.environ.setdefault("MDITOR_WEB_DIR", str(ROOT / "web" / "dist"))  # 빌드 명령(vercel.json)이 만든다

# Vercel 함수는 요청·응답 본문이 4.5MB 까지다. 그림은 base64 로 4/3 배가 되어 실리므로 3MB 로 줄인다
# (화면은 /api/config 의 maxImageBytes 를 보고 그 이상은 붙이기 전에 막는다).
os.environ.setdefault("MDITOR_MAX_BODY_BYTES", "4400000")
os.environ.setdefault("MDITOR_MAX_IMAGE_BYTES", "3000000")

from mditor.api import create_app

app = create_app()
