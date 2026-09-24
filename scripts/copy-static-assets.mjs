// Copies the coi-serviceworker script into public/ so Vite serves it as a
// plain static asset. Run before `dev` and `build` (see package.json).
//
// The ONNX Runtime Web WASM/worker files do NOT need copying here: they're
// imported directly with Vite's `?url` suffix in src/model/session.ts,
// which lets Vite's own asset pipeline emit a single canonical hashed copy
// instead of duplicating the ~28 MB file (see the comment in session.ts
// and plan/DECISIONS.md D-06).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coiSrc = join(root, "node_modules", "coi-serviceworker", "coi-serviceworker.min.js");
const coiOut = join(root, "public", "coi-serviceworker.min.js");

mkdirSync(join(root, "public"), { recursive: true });

if (!existsSync(coiSrc)) {
  console.error(`copy-static-assets: expected file missing: ${coiSrc}`);
  process.exit(1);
}
copyFileSync(coiSrc, coiOut);

console.log("copy-static-assets: copied coi-serviceworker to public/");
