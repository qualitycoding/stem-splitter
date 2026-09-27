// Standalone build for the local perf-check page (plans/perf-divergence,
// user-requested: "a page I can run locally to measure real performance on
// my own machine" — separate from the S-104/S-105 vitest-driven matrix,
// which can't run representatively in a cloud execution container).
//
// Deliberately its OWN Vite project, decoupled from the main app's
// vite.config.ts/index.html: it must never become part of the deployed app
// bundle (deployment is out of scope for this plan — plan/PROFILE.md
// software.deploys=false). Build/serve with:
//   npx vite --config perf/standalone/vite.config.ts          (dev server)
//   npx vite build --config perf/standalone/vite.config.ts    (static site -> perf/standalone/dist/)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

// coi-serviceworker (vendored by the main app too — public/coi-serviceworker.min.js,
// scripts/copy-static-assets.mjs) lets a plain static host like GitHub Pages,
// which can't set custom response headers, still cross-origin-isolate the
// page (via a client-side Service Worker) so multi-threaded WASM works.
mkdirSync(join(HERE, "public"), { recursive: true });
const coiDest = join(HERE, "public", "coi-serviceworker.min.js");
if (!existsSync(coiDest)) {
  copyFileSync(join(REPO_ROOT, "node_modules", "coi-serviceworker", "coi-serviceworker.min.js"), coiDest);
}

function gitShaAtConfigLoad(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "0".repeat(40);
  }
}
function lockfileSha256AtConfigLoad(): string {
  try {
    return createHash("sha256").update(readFileSync(join(REPO_ROOT, "package-lock.json"))).digest("hex");
  } catch {
    return "0".repeat(64);
  }
}

export default defineConfig({
  // Explicit: running `vite --config perf/standalone/vite.config.ts` from
  // the repo root (as the npm scripts do) would otherwise default `root` to
  // the CWD and build straight into the *main app's* (gitignored) dist/.
  root: HERE,
  // Relative asset paths: works whether opened from a `vite preview` server
  // at "/", or hosted at a GitHub Pages project sub-path.
  base: "./",
  define: {
    __PERF_GIT_SHA__: JSON.stringify(gitShaAtConfigLoad()),
    __PERF_LOCKFILE_SHA256__: JSON.stringify(lockfileSha256AtConfigLoad()),
  },
  build: {
    target: "es2022",
    outDir: join(HERE, "dist"),
    emptyOutDir: true,
  },
});
