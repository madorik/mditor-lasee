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

    # 광고(Google AdSense). client 가 비면 광고 코드를 넣지 않는다.
    adsense_client: str = field(default_factory=lambda: os.environ.get("ADSENSE_CLIENT", "").strip())
    adsense_slot_content: str = field(default_factory=lambda: os.environ.get("ADSENSE_SLOT_CONTENT", "").strip())
    adsense_slot_editor: str = field(default_factory=lambda: os.environ.get("ADSENSE_SLOT_EDITOR", "").strip())
    site_verification: str = field(default_factory=lambda: os.environ.get("GOOGLE_SITE_VERIFICATION", "").strip())
    contact_email: str = field(default_factory=lambda: os.environ.get("MDITOR_CONTACT_EMAIL", "").strip())


def syntax_guide() -> str:
    return (_DATA / "syntax.md").read_text(encoding="utf-8")


def example_md() -> str:
    return (_DATA / "example.md").read_text(encoding="utf-8")
