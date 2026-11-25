// 편집기 패키지 묶기.
//   vite build              → dist/index.js · core.js · react.js (ESM, 의존 패키지는 밖에 둔다)
//   vite build --mode umd   → dist/lasee-mditor.umd.js (<script> 하나로 — TipTap 까지 담는다, 전역 LaSeeMDitor)
//   vite                    → demo/ (서버 없이 돌려 보기)
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

export default defineConfig(({ mode }) =>
  mode === "umd"
    ? {
        build: {
          outDir: "dist",
          emptyOutDir: false,
          lib: { entry: resolve(here, "src/umd.ts"), name: "LaSeeMDitor", formats: ["umd"], fileName: () => "lasee-mditor.umd.js" },
        },
      }
    : {
        plugins: [react()],
        build: {
          outDir: "dist",
          emptyOutDir: false,
          lib: {
            entry: { index: resolve(here, "src/index.ts"), core: resolve(here, "src/core.ts"), react: resolve(here, "src/react.tsx") },
            formats: ["es"],
          },
          rollupOptions: { external: [/^@tiptap\//, "react", "react-dom", "react/jsx-runtime", "react-dom/client"] },
        },
      },
);
