import { describe, expect, it } from "vitest";
import { createSession } from "../../src/model/session";

import tinyModelUrl from "../fixtures/tiny-stem-model.onnx?url";

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  return res.arrayBuffer();
}

describe("createSession execution-provider fallback (T-010)", () => {
  it("falls back to wasm when navigator.gpu reports no adapter", async () => {
    // Shadow navigator.gpu with a stub that always reports unavailable,
    // then remove the shadow so later tests see the browser's real value.
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: async () => null },
      configurable: true,
    });
    try {
      const bytes = await fetchBytes(tinyModelUrl);
      const { session, executionProvider } = await createSession(bytes);
      expect(executionProvider).toBe("wasm");
      await session.release();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).gpu;
    }
  }, 30_000);

  it("falls back to wasm when navigator.gpu is entirely absent", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    try {
      const bytes = await fetchBytes(tinyModelUrl);
      const { session, executionProvider } = await createSession(bytes);
      expect(executionProvider).toBe("wasm");
      await session.release();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).gpu;
    }
  }, 30_000);

  it("records whichever EP the current browser actually resolves, unmodified", async () => {
    const bytes = await fetchBytes(tinyModelUrl);
    const { session, executionProvider } = await createSession(bytes);
    expect(["webgpu", "wasm"]).toContain(executionProvider);
    await session.release();
  }, 30_000);
});
