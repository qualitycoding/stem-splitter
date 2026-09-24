import { sha256Hex } from "../hash";
import type { ModelInfo } from "./hub";

const CACHE_NAME = "stem-splitter-models-v1";
const MAX_ATTEMPTS = 3;

export interface FetchProgress {
  loaded: number;
  total: number;
}

export class ModelIntegrityError extends Error {
  constructor(source: string, expected: string, actual: string) {
    super(`Model integrity check failed for ${source}: expected sha256 ${expected}, got ${actual}.`);
    this.name = "ModelIntegrityError";
  }
}

export class ModelDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDownloadError";
  }
}

async function fetchWithProgress(url: string, onProgress?: (p: FetchProgress) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { mode: "cors" });
  } catch (err) {
    throw new ModelDownloadError(`Could not reach ${url}.`, { cause: err });
  }
  if (!res.ok) throw new ModelDownloadError(`Model download failed: HTTP ${res.status} from ${url}`);
  if (!res.body) {
    // No streaming body available (rare) — fall back to a single await.
    const buf = await res.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength });
    return buf;
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a model, verifying it against `info.sha256`, using the Cache API
 * so a repeat load — even after a page reload — doesn't re-download
 * (T-012, T-022). Retries transient failures 3x with backoff (plan/PLAN.md
 * "Decision rules"); on an integrity mismatch the bad cache entry is
 * evicted and refetched once, not endlessly retried.
 */
export async function getModel(info: ModelInfo, onProgress?: (p: FetchProgress) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(info.url);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if ((await sha256Hex(bytes)) === info.sha256) {
      onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength });
      return bytes;
    }
    await cache.delete(info.url); // corrupted cache entry — fall through to refetch
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const bytes = await fetchWithProgress(info.url, onProgress);
      const actual = await sha256Hex(bytes);
      if (actual !== info.sha256) throw new ModelIntegrityError(info.url, info.sha256, actual);
      await cache.put(info.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
      return bytes;
    } catch (err) {
      lastError = err;
      if (err instanceof ModelIntegrityError || attempt === MAX_ATTEMPTS) break;
      await sleep(2 ** attempt * 500); // 1s, then 2s
    }
  }
  throw lastError instanceof Error ? lastError : new ModelDownloadError(String(lastError));
}

/**
 * Verifies a model file the user picked from disk (R-02 fallback for a
 * Hugging Face outage). Does not touch the Cache API.
 */
export async function verifyLocalModel(file: File, info: ModelInfo): Promise<ArrayBuffer> {
  const bytes = await file.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== info.sha256) throw new ModelIntegrityError(file.name, info.sha256, actual);
  return bytes;
}
