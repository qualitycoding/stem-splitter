// D-09 (plan/DECISIONS.md). Also: no innerHTML with user-derived strings
// anywhere in this app (see src/ui.ts) — R-06/T-024/T-025 in plan/PLAN.md.

export const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_DURATION_SECONDS = 10 * 60; // 10 min
export const WARN_DURATION_SECONDS = 5 * 60; // 5 min

export class FileTooLargeError extends Error {
  constructor(bytes: number) {
    super(`This file is ${(bytes / 1e6).toFixed(0)} MB; the limit is ${(MAX_FILE_BYTES / 1e6).toFixed(0)} MB.`);
    this.name = "FileTooLargeError";
  }
}

export class AudioTooLongError extends Error {
  constructor(seconds: number) {
    super(
      `This audio is ${(seconds / 60).toFixed(1)} min long; the limit is ${(MAX_DURATION_SECONDS / 60).toFixed(0)} min.`,
    );
    this.name = "AudioTooLongError";
  }
}

export function checkFileSize(file: File): void {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError(file.size);
}

export interface DurationCheck {
  seconds: number;
  warn: boolean;
}

export function checkDuration(sampleCount: number, sampleRate: number): DurationCheck {
  const seconds = sampleCount / sampleRate;
  if (seconds > MAX_DURATION_SECONDS) throw new AudioTooLongError(seconds);
  return { seconds, warn: seconds > WARN_DURATION_SECONDS };
}
