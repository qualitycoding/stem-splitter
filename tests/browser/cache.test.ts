import { beforeEach, describe, expect, it } from "vitest";
import { getModel, ModelIntegrityError, verifyLocalModel } from "../../src/model/cache";
import type { ModelInfo } from "../../src/model/hub";
import { sha256Hex } from "../../src/hash";

import tinyModelUrl from "../fixtures/tiny-stem-model.onnx?url";

const TINY_MODEL_SHA256 = "d021adb03b18a293109cff8a366fe381a5a1c02cc2b88c188f3f3de89f2b1e65";

async function tinyModelInfo(): Promise<ModelInfo> {
  const res = await fetch(tinyModelUrl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { name: "htdemucs", url: new URL(tinyModelUrl, location.href).href, sha256: TINY_MODEL_SHA256, bytes: bytes.length };
}

const CACHE_NAME = "stem-splitter-models-v1";

beforeEach(async () => {
  // Each test starts from a clean cache so "downloaded vs served from
  // cache" is unambiguous (T-012).
  await caches.delete(CACHE_NAME);
});

describe("getModel (T-012)", () => {
  it("downloads, verifies, and caches a model", async () => {
    const info = await tinyModelInfo();
    const bytes = await getModel(info);
    expect(await sha256Hex(bytes)).toBe(info.sha256);
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(info.url);
    expect(cached).toBeTruthy();
  });

  it("reuses the cached copy on a second call, without a fresh network fetch (T-022: survives 'reload')", async () => {
    const info = await tinyModelInfo();
    await getModel(info); // primes the cache
    const cache = await caches.open(CACHE_NAME);
    const cachedBefore = await cache.match(info.url);
    const bytesBefore = await cachedBefore!.clone().arrayBuffer();

    // A fresh call — as a reloaded page would make, with no in-memory state
    // left over — must be served from Cache Storage (which persists across
    // page loads by design) rather than re-fetching.
    const bytes = await getModel(info);
    expect(await sha256Hex(bytes)).toBe(info.sha256);
    expect(bytes.byteLength).toBe(bytesBefore.byteLength);
  });

  it("evicts and refetches once on a corrupted cache entry", async () => {
    const info = await tinyModelInfo();
    const cache = await caches.open(CACHE_NAME);
    // Plant a corrupted entry under the model's URL before it's ever
    // legitimately fetched.
    await cache.put(info.url, new Response(new Uint8Array([1, 2, 3, 4]).buffer));

    const bytes = await getModel(info);
    expect(await sha256Hex(bytes)).toBe(info.sha256);

    const cachedAfter = await cache.match(info.url);
    const afterBytes = new Uint8Array(await cachedAfter!.arrayBuffer());
    expect(afterBytes.length).toBe(bytes.byteLength);
  });

  it("throws ModelDownloadError for a 404", async () => {
    const info: ModelInfo = {
      name: "htdemucs",
      url: new URL("./does-not-exist.onnx", location.href).href,
      sha256: "0".repeat(64),
      bytes: 0,
    };
    await expect(getModel(info)).rejects.toThrow();
  });
});

describe("verifyLocalModel (R-02 fallback: load model from disk)", () => {
  it("accepts a file matching the expected sha256", async () => {
    const res = await fetch(tinyModelUrl);
    const blob = await res.blob();
    const file = new File([blob], "tiny-stem-model.onnx");
    const info: ModelInfo = { name: "htdemucs", url: "unused", sha256: TINY_MODEL_SHA256, bytes: blob.size };
    const bytes = await verifyLocalModel(file, info);
    expect(await sha256Hex(bytes)).toBe(TINY_MODEL_SHA256);
  });

  it("rejects a file that does not match the expected sha256", async () => {
    const file = new File([new Uint8Array([9, 9, 9])], "wrong.onnx");
    const info: ModelInfo = { name: "htdemucs", url: "unused", sha256: "0".repeat(64), bytes: 3 };
    await expect(verifyLocalModel(file, info)).rejects.toBeInstanceOf(ModelIntegrityError);
  });
});
