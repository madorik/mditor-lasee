"""그림 저장소 — 편집기에서 넣은 그림을 Cloudflare R2(S3 호환)에 올리고 ``/i/<이름>`` 으로 내준다.

- 받은 그림은 다시 그려 깨끗한 PNG · JPEG 로 바꾼다. 그림이 아닌 파일은 받지 않고, 사진의 위치(EXIF) 같은 메타데이터는 남기지 않는다.
- 이름은 내용의 해시 + 크기다(``<해시32자>-<가로>x<세로>.png``). 같은 그림은 한 번만 올라가고, 한 번 올린 것은 바뀌지 않는다.
  크기가 이름에 있으므로 쪽 배치는 그림을 내려받지 않고 자리를 잡는다.
- 문서에는 ``![설명](https://<서비스 주소>/i/<이름>)`` 으로 들어간다. 주소의 앞부분(호스트)은 보지 않고 이름만 보고
  이 저장소에서 꺼낸다 — 바깥 주소로 요청을 보내지 않는다.
"""

from __future__ import annotations

import hashlib
import io
import re
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Protocol

from .i18n import t

NAME = r"[0-9a-f]{32}-(\d{1,5})x(\d{1,5})\.(png|jpg)"
_NAME = re.compile(rf"^{NAME}$")
_SRC = re.compile(rf"^(?:https?://[^/\s]+)?/i/({NAME})$")
MEDIA = {"png": "image/png", "jpg": "image/jpeg"}
MAX_SIDE = 4000  # 화면은 1600 으로 줄여 보낸다. 그보다 크게 오면 다시 그리기 전에 막는다
PREFIX = "i/"  # 버킷 안의 자리


class BadImage(ValueError):
    """그림 파일이 아니거나 너무 크다."""


class Store(Protocol):
    def put(self, name: str, data: bytes, media_type: str) -> None: ...
    def get(self, name: str) -> bytes | None: ...


def valid_name(name: str) -> bool:
    return bool(_NAME.match(name))


def name_of_src(src: str) -> str | None:
    """문서의 그림 주소가 이 저장소의 그림이면 그 이름."""
    m = _SRC.match(src.strip())
    return m.group(1) if m else None


def size_of(name: str) -> tuple[int, int]:
    m = _NAME.match(name)
    if not m:
        raise ValueError(name)
    return int(m.group(1)), int(m.group(2))


def normalize(data: bytes) -> tuple[bytes, str, int, int]:
    """받은 바이트 → (다시 그린 바이트, 확장자, 가로, 세로). JPEG 는 JPEG 로, 나머지는 PNG 로."""
    from PIL import Image

    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        if fmt not in ("PNG", "JPEG", "GIF", "WEBP", "BMP"):
            raise BadImage(t("PNG · JPEG · GIF · WebP 그림만 올릴 수 있습니다."))
        w, h = im.size
        if w < 1 or h < 1 or w > MAX_SIDE or h > MAX_SIDE:
            raise BadImage(t("그림이 너무 큽니다. 가로 · 세로 {n}px 까지 올릴 수 있습니다.", n=MAX_SIDE))
        im.load()  # 움직이는 GIF 는 첫 장면만 쓴다(PDF 에는 움직임이 없다)
    except BadImage:
        raise
    except Exception as e:
        raise BadImage(t("그림 파일을 읽지 못했습니다.")) from e
    out = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(out, "JPEG", quality=90, optimize=True)
        ext = "jpg"
    else:
        alpha = "A" in im.mode or "transparency" in im.info
        im.convert("RGBA" if alpha else "RGB").save(out, "PNG", optimize=True)
        ext = "png"
    return out.getvalue(), ext, w, h


def name_for(data: bytes, ext: str, w: int, h: int) -> str:
    return f"{hashlib.sha256(data).hexdigest()[:32]}-{w}x{h}.{ext}"


class R2Store:
    """Cloudflare R2. 버킷은 공개하지 않는다 — 그림은 이 서버의 /i/ 로 내준다(앞단 CDN 이 담아 둔다)."""

    def __init__(self, account_id: str, access_key_id: str, secret_access_key: str, bucket: str) -> None:
        self._args = (account_id, access_key_id, secret_access_key)
        self.bucket = bucket
        self._client: Any = None
        self._lock = threading.Lock()

    def _s3(self) -> Any:
        with self._lock:
            if self._client is None:
                import boto3  # 그림을 쓸 때만 불러온다(무겁다)
                from botocore.config import Config

                account_id, key_id, secret = self._args
                self._client = boto3.client(
                    "s3",
                    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                    aws_access_key_id=key_id,
                    aws_secret_access_key=secret,
                    region_name="auto",
                    config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=20, retries={"max_attempts": 2}),
                )
            return self._client

    def put(self, name: str, data: bytes, media_type: str) -> None:
        self._s3().put_object(
            Bucket=self.bucket, Key=PREFIX + name, Body=data, ContentType=media_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    def get(self, name: str) -> bytes | None:
        s3 = self._s3()
        try:
            return s3.get_object(Bucket=self.bucket, Key=PREFIX + name)["Body"].read()
        except s3.exceptions.NoSuchKey:
            return None


class DirStore:
    """디스크 폴더(도커 볼륨 · 로컬 개발). 이름이 검사된 해시라 폴더 밖으로 나가지 않는다."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def put(self, name: str, data: bytes, media_type: str) -> None:
        if not valid_name(name):
            raise ValueError(name)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f".{name}.tmp"
        tmp.write_bytes(data)
        tmp.replace(self.root / name)

    def get(self, name: str) -> bytes | None:
        path = self.root / name
        return path.read_bytes() if valid_name(name) and path.is_file() else None


class MemoryStore:
    """시험용 · 로컬용 — 프로세스 메모리에 둔다."""

    def __init__(self) -> None:
        self.items: dict[str, bytes] = {}

    def put(self, name: str, data: bytes, media_type: str) -> None:
        self.items[name] = data

    def get(self, name: str) -> bytes | None:
        return self.items.get(name)


class Cached:
    """꺼낸 그림을 잠깐 담아 둔다 — PDF 미리보기는 고칠 때마다 같은 그림을 다시 쓴다."""

    def __init__(self, store: Store, limit: int = 48_000_000) -> None:
        self.store, self.limit = store, limit
        self._items: OrderedDict[str, bytes] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def put(self, name: str, data: bytes, media_type: str) -> None:
        self.store.put(name, data, media_type)
        self._keep(name, data)

    def get(self, name: str) -> bytes | None:
        with self._lock:
            if name in self._items:
                self._items.move_to_end(name)
                return self._items[name]
        data = self.store.get(name)
        if data is not None:
            self._keep(name, data)
        return data

    def _keep(self, name: str, data: bytes) -> None:
        if len(data) > self.limit // 4:
            return
        with self._lock:
            if name in self._items:
                return
            self._items[name] = data
            self._size += len(data)
            while self._size > self.limit:
                _, old = self._items.popitem(last=False)
                self._size -= len(old)


def hosted(doc: dict[str, Any]) -> dict[str, str]:
    """문서에서 이 저장소의 그림을 찾는다 — {그림 주소: 이름}."""
    out: dict[str, str] = {}
    for b in _blocks(doc):
        if b.get("kind") == "image":
            src = str(b.get("src") or "")
            name = name_of_src(src)
            if name:
                out[src] = name
    return out


def sizes(doc: dict[str, Any]) -> dict[str, list[int]]:
    """쪽 배치용 — 이름에 적힌 크기. 그림을 내려받지 않는다."""
    return {src: list(size_of(name)) for src, name in hosted(doc).items()}


def fetch(doc: dict[str, Any], store: Store | None, limit: int) -> dict[str, bytes]:
    """PDF 용 — 저장소에서 그림을 꺼낸다. 없는 그림 · 한도를 넘는 그림은 빼고(자리만 그린다)."""
    out: dict[str, bytes] = {}
    if store is None:
        return out
    total = 0
    for src, name in hosted(doc).items():
        data = store.get(name)
        if data is None:
            continue
        total += len(data)
        if total > limit:
            break
        out[src] = data
    return out


def _blocks(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [b for s in doc.get("sections") or [] for b in s.get("blocks") or [] if isinstance(b, dict)]
