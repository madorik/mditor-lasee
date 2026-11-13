import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// 정적 쪽(index·syntax·developers·privacy·terms)과 편집기(edit)를 따로 묶는다.
const pages = ["index", "edit", "syntax", "developers", "privacy", "terms", "404"];

/** 개발 서버에서도 /edit, /syntax 같은 깨끗한 주소가 열리게 한다(운영은 API 서버가 한다). */
function cleanUrls(): Plugin {
  return {
    name: "mditor-clean-urls",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? "").split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
        if (pages.includes(path) && path !== "index") req.url = `/${path}.html${(req.url ?? "").slice(path.length + 1)}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanUrls()],
  build: {
    rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])) },
  },
  server: {
    fs: { allow: [".."] }, // 예시 문서(src/mditor/data/example.md)를 서버와 같이 쓴다
    proxy: { "/api": "http://127.0.0.1:8000", "/mcp": "http://127.0.0.1:8000", "/d": "http://127.0.0.1:8000" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
