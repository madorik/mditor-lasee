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

/**
 * 편집 화면은 늘 문서 탭(편집기)으로 연다 — 늦게 불러오는 편집기 덩어리(RichEditor)를 HTML 에서 미리 받게 한다.
 * 안 그러면 화면 코드가 다 돌고 나서야 받기 시작해(느린 망에서 수 초) 편집기가 늦게 열렸다.
 */
function preloadEditor(): Plugin {
  return {
    name: "mditor-preload-editor",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!/(^|\/)edit\.html$/.test(ctx.path) || !ctx.bundle) return html;
        const rich = Object.values(ctx.bundle).find((c) => c.type === "chunk" && !!c.facadeModuleId?.endsWith("/src/editor/RichEditor.tsx"));
        if (!rich || rich.type !== "chunk") return html;
        const js = [rich.fileName, ...rich.imports];
        const css = [...(rich.viteMetadata?.importedCss ?? [])];
        return [
          ...js.map((f) => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `/${f}` }, injectTo: "head" as const })),
          ...css.map((f) => ({ tag: "link", attrs: { rel: "preload", as: "style", href: `/${f}` }, injectTo: "head" as const })),
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanUrls(), preloadEditor()],
  // 편집기 패키지(web/packages/lasee-mditor)는 소스를 바로 쓴다 — npm 으로 낼 때는 그 폴더에서 따로 묶는다
  resolve: { alias: { "@watalabs/lasee-mditor": resolve(import.meta.dirname, "packages/lasee-mditor/src") } },
  build: {
    rollupOptions: { input: Object.fromEntries(entries.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])) },
  },
  server: {
    fs: { allow: [".."] }, // 예시 문서(src/mditor/data/example.md)를 서버와 같이 쓴다
    proxy: { "/api": "http://127.0.0.1:8000", "/mcp": "http://127.0.0.1:8000", "/d": "http://127.0.0.1:8000", "/i": "http://127.0.0.1:8000" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"] },
});
