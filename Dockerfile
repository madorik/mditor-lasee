# MDitor — 화면(정적 파일)을 빌드해 API 서버 하나에 담는다.

# 1) 화면 빌드
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# 예시 문서는 서버와 같이 쓴다(web/src/editor/App.tsx 가 가져온다)
COPY src/mditor/data/example.md /app/src/mditor/data/example.md
RUN npm run build

# 2) 서버
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --extra server
COPY --from=web /app/web/dist ./web/dist

ENV MDITOR_WEB_DIR=/app/web/dist \
    MDITOR_CACHE_DIR=/tmp/mditor-cache \
    PORT=8000
EXPOSE 8000
USER nobody
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/healthz', timeout=3)"
CMD ["/app/.venv/bin/mditor-server"]
