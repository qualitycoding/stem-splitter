import { sha256Hex } from "./hash";
import type { ExecutionProvider } from "./model/session";
import type { SeparationMode } from "./separate";

// Set by vite.config.ts `define` from the VITE_GIT_SHA env var the deploy
// workflow passes (plan/templates/deploy.yml); "dev" locally.
declare const __GIT_SHA__: string;

export interface ProvenanceModel {
  name: string;
  sha256: string;
}

export interface Provenance {
  appVersion: string;
  ortVersion: string;
  models: ProvenanceModel[];
  inputSha256: string;
  inputFileName: string;
  generatedAt: string;
  executionProvider: ExecutionProvider;
  threadCount: number;
  mode: SeparationMode;
}

export interface BuildProvenanceInput {
  ortVersion: string;
  models: ProvenanceModel[];
  inputSha256: string;
  inputFileName: string;
  executionProvider: ExecutionProvider;
  threadCount: number;
  mode: SeparationMode;
}

export function buildProvenance(input: BuildProvenanceInput): Provenance {
  return {
    appVersion: __GIT_SHA__,
    ortVersion: input.ortVersion,
    models: input.models,
    inputSha256: input.inputSha256,
    inputFileName: input.inputFileName,
    generatedAt: new Date().toISOString(),
    executionProvider: input.executionProvider,
    threadCount: input.threadCount,
    mode: input.mode,
  };
}

export function provenanceBlob(provenance: Provenance): Blob {
  return new Blob([JSON.stringify(provenance, null, 2)], { type: "application/json" });
}

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}
