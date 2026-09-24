import { defineConfig } from "vite";

// COOP/COEP so `npm run dev` / `npm run preview` match the isolation the
// deployed page gets from coi-serviceworker (D-06, plan/REVIEW.md #1/#13).
function crossOriginIsolation() {
  return {
    name: "cross-origin-isolation",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
    configurePreviewServer(server: import("vite").PreviewServer) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
  };
}

// Vite's dev server injects CSS as <style> tags for HMR; the production
// build instead emits a linked .css file, so the strict `style-src 'self'`
// in index.html (D-08) only needs relaxing for `dev`/`preview`, never for
// the deployed build.
function devStyleSrcRelax() {
  return {
    name: "dev-style-src-relax",
    apply: "serve" as const,
    transformIndexHtml(html: string) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    },
  };
}

export default defineConfig({
  // D-10: served from https://qualitycoding.github.io/stem-splitter/
  base: "/stem-splitter/",
  plugins: [crossOriginIsolation(), devStyleSrcRelax()],
  worker: {
    // The separation worker is a native ES module worker (see src/worker.ts),
    // not classic — required for `import * as ort from "onnxruntime-web"`
    // inside it (plan/REVIEW.md #1).
    format: "es",
  },
  define: {
    __GIT_SHA__: JSON.stringify(process.env.VITE_GIT_SHA ?? "dev"),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
