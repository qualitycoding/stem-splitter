import { SEGMENT_SAMPLES } from "./chunk";

/**
 * Row order of the model's `stems` output, (1, 4, 2, SEGMENT_SAMPLES) —
 * source-major, then channel, then sample. Fixed by demucs_onnx (SOURCES in
 * demucs_onnx/inference.py); do not reorder.
 */
export const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/**
 * Views (not copies) of one source's [left, right] channels out of a flat
 * model output buffer. The htdemucs_ft specialist for `stem` also emits all
 * four rows (bag aggregation is one-hot — see demucs_onnx/inference.py
 * module docstring); callers keep only the matching row.
 */
export function extractStem(
  data: Float32Array,
  stem: StemName,
  segment: number = SEGMENT_SAMPLES,
): [left: Float32Array, right: Float32Array] {
  const row = STEM_NAMES.indexOf(stem);
  if (row === -1) throw new RangeError(`extractStem: unknown stem "${stem}"`);
  const base = row * 2 * segment;
  return [data.subarray(base, base + segment), data.subarray(base + segment, base + 2 * segment)];
}
