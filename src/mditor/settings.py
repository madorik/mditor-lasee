"""환경변수 설정."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# 서비스를 올린 주소가 정해지면 여기(또는 환경변수 MDITOR_PUBLIC_URL)에 적는다.
# 로컬(stdio) MCP 가 '웹 편집기에서 열기' 링크를 만들 때 쓴다. 비어 있으면 링크를 만들지 않는다.
DEFAULT_PUBLIC_URL = ""

_DATA = Path(__file__).parent / "data"


def _flag(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _web_dir() -> Path:
    env = os.environ.get("MDITOR_WEB_DIR")
    if env:
        return Path(env)
    packaged = Path(__file__).parent / "web"
    return packaged if packaged.exists() else Path(__file__).resolve().parents[2] / "web" / "dist"


@dataclass
class Settings:
    public_url: str = field(default_factory=lambda: os.environ.get("MDITOR_PUBLIC_URL", DEFAULT_PUBLIC_URL).rstrip("/"))
    web_dir: Path = field(default_factory=_web_dir)
    cache_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("MDITOR_CACHE_DIR") or Path(tempfile.gettempdir()) / "mditor-cache")
    )
    max_md_chars: int = field(default_factory=lambda: _int("MDITOR_MAX_MD_CHARS", 400_000))
    max_body_bytes: int = field(default_factory=lambda: _int("MDITOR_MAX_BODY_BYTES", 12_000_000))
    max_image_bytes: int = field(default_factory=lambda: _int("MDITOR_MAX_IMAGE_BYTES", 8_000_000))
    rate_per_minute: int = field(default_factory=lambda: _int("MDITOR_RATE_PER_MINUTE", 240))
    download_ttl: int = field(default_factory=lambda: _int("MDITOR_DOWNLOAD_TTL", 1800))
    trust_proxy: bool = field(default_factory=lambda: _flag("MDITOR_TRUST_PROXY", True))

    # AI 수정 — 키가 있을 때만 켜진다. 비용이 드니 IP 당 하루 횟수를 제한한다.
    ai_enabled: bool = field(
        default_factory=lambda: _flag(
            "MDITOR_AI_ENABLED", bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
        )
    )
    ai_model: str = field(default_factory=lambda: os.environ.get("MDITOR_AI_MODEL", "claude-opus-5-5"))
    ai_effort: str = field(default_factory=lambda: os.environ.get("MDITOR_AI_EFFORT", "medium"))
    ai_daily_limit: int = field(default_factory=lambda: _int("MDITOR_AI_DAILY_LIMIT", 10))
    ai_max_md_chars: int = field(default_factory=lambda: _int("MDITOR_AI_MAX_MD_CHARS", 60_000))

    # 그림 저장소(Cloudflare R2). 넷이 모두 있어야 켜진다 — 없으면 그림은 예전처럼 문서와 함께 브라우저에만 둔다.
    r2_account_id: str = field(default_factory=lambda: os.environ.get("R2_ACCOUNT_ID", "").strip())
    r2_access_key_id: str = field(default_factory=lambda: os.environ.get("R2_ACCESS_KEY_ID", "").strip())
    r2_secret_access_key: str = field(default_factory=lambda: os.environ.get("R2_SECRET_ACCESS_KEY", "").strip())
    r2_bucket: str = field(default_factory=lambda: os.environ.get("R2_BUCKET", "").strip())
    # R2 대신 디스크 폴더에 둔다(도커 볼륨 · 로컬 개발). R2 설정이 있으면 R2 가 먼저다.
    image_dir: str = field(default_factory=lambda: os.environ.get("MDITOR_IMAGE_DIR", "").strip())
    # 원본 파일 한도(화면이 줄이기 전에 본다)와, 화면이 줄여서 보낸 그림 한 장의 한도(서버가 본다)
    max_image_file_bytes: int = field(default_factory=lambda: _int("MDITOR_MAX_IMAGE_FILE_BYTES", 10_000_000))
    max_upload_bytes: int = field(default_factory=lambda: _int("MDITOR_MAX_UPLOAD_BYTES", 3_000_000))
    upload_daily_limit: int = field(default_factory=lambda: _int("MDITOR_UPLOAD_DAILY_LIMIT", 100))
    # 올린 그림을 두는 날 수. R2 는 버킷의 수명 규칙(lifecycle)이 지운다 — 이 값과 맞춰 둔다. 폴더 저장소는 올릴 때 지난 것을 지운다.
    image_ttl_days: int = field(default_factory=lambda: _int("MDITOR_IMAGE_TTL_DAYS", 3))

    # 광고(Google AdSense). client 가 비면 광고 코드를 넣지 않는다.
    adsense_client: str = field(default_factory=lambda: os.environ.get("ADSENSE_CLIENT", "").strip())
    adsense_slot_content: str = field(default_factory=lambda: os.environ.get("ADSENSE_SLOT_CONTENT", "").strip())
    adsense_slot_editor: str = field(default_factory=lambda: os.environ.get("ADSENSE_SLOT_EDITOR", "").strip())
    site_verification: str = field(default_factory=lambda: os.environ.get("GOOGLE_SITE_VERIFICATION", "").strip())
    naver_site_verification: str = field(default_factory=lambda: os.environ.get("NAVER_SITE_VERIFICATION", "").strip())
    bing_site_verification: str = field(default_factory=lambda: os.environ.get("BING_SITE_VERIFICATION", "").strip())
    contact_email: str = field(default_factory=lambda: os.environ.get("MDITOR_CONTACT_EMAIL", "").strip())
    # 방문 통계(Vercel Web Analytics). Vercel 에 배포하면 켜진다(VERCEL=1) — 다른 곳에는 /_vercel/insights 가 없다.
    analytics: bool = field(default_factory=lambda: _flag("MDITOR_ANALYTICS", bool(os.environ.get("VERCEL"))))

    @property
    def r2_enabled(self) -> bool:
        return all((self.r2_account_id, self.r2_access_key_id, self.r2_secret_access_key, self.r2_bucket))


def syntax_guide() -> str:
    return (_DATA / "syntax.md").read_text(encoding="utf-8")


def llms_txt(public_url: str) -> str:
    """AI 검색 · 답변 엔진이 읽는 사이트 안내(/llms.txt)."""
    return (_DATA / "llms.md").read_text(encoding="utf-8").replace("%PUBLIC_URL%", public_url)


def example_md() -> str:
    return (_DATA / "example.md").read_text(encoding="utf-8")
