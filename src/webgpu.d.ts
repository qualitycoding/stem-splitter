// Minimal ambient declaration for the one WebGPU entry point this app uses
// (feature detection in src/model/session.ts). Deliberately not the full
// @webgpu/types surface — see plan/ENVIRONMENT.md for why dependencies stay
// pinned and minimal.
interface Navigator {
  readonly gpu?: {
    requestAdapter(): Promise<object | null>;
  };
}
