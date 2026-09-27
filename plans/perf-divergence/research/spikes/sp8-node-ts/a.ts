import type { X } from "./b.ts";
export function f(a: number): number { const x: X = { n: a }; return x.n * 2; }
