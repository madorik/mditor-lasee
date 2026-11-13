"""배포 설정 점검."""

from pathlib import Path

import pytest

tomllib = pytest.importorskip("tomllib")  # 3.11+

ROOT = Path(__file__).resolve().parents[1]


def test_server_group_matches_server_extra():
    # Vercel 은 엑스트라를 깔지 않아 같은 의존성을 기본 그룹에도 둔다 — 둘이 어긋나면 배포본만 달라진다
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert project["dependency-groups"]["server"] == project["project"]["optional-dependencies"]["server"]
    assert "server" in project["tool"]["uv"]["default-groups"]
