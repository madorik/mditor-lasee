import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// 정적 쪽(index·syntax·developers·privacy·terms)과 편집기(edit)를 따로 묶는다.
// 한국어는 뿌리(/), 다른 언어는 /<언어>/ 아래에 같은 이름으로 둔다(web/en/*.html).
const pages = ["index", "edit", "syntax", "developers", "privacy", "terms", "404"];
const LANGS = ["en"];
const entries = [...pages, ...LANGS.flatMap((l) => pages.map((p) => `${l}/${p}`))].filter((p) => existsSync(resolve(import.meta.dirname, `${p}.html`)));

/** 개발 서버에서도 /edit, /en/syntax 같은 깨끗한 주소가 열리게 한다(운영은 API 서버가 한다). */
function cleanUrls(): Plugin {
  return {
    name: "mditor-clean-urls",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        const path = url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
        const rest = url.slice(url.split(/[?#]/)[0].length);
        if (LANGS.includes(path)) req.url = `/${path}/index.html${rest}`;
        else if (entries.includes(path) && !path.endsWith("index")) req.url = `/${path}.html${rest}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanUrls()],
  build: {
    rollupOptions: { input: Object.fromEntries(entries.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])) },
  },
  server: {
    fs: { allow: [".."] }, // 예시 문서(src/mditor/data/example.md)를 서버와 같이 쓴다
    proxy: { "/api": "http://127.0.0.1:8000", "/mcp": "http://127.0.0.1:8000", "/d": "http://127.0.0.1:8000", "/i": "http://127.0.0.1:8000" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
