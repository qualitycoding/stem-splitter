import { decodeTo44k } from "./audio/decode";
import { AudioInputError } from "./audio/errors";
import { encodeWavPCM16, wavBlob } from "./audio/wav";
import type { StemName } from "./dsp/stems";
import { sha256Hex } from "./hash";
import { webgpuAvailable } from "./webgpu-detect";
import { type Provenance, provenanceBlob } from "./provenance";
import type { SeparationMode } from "./separate";
import {
  AudioTooLongError,
  checkDuration,
  checkFileSize,
  FileTooLargeError,
  MAX_DURATION_SECONDS,
  MAX_FILE_BYTES,
} from "./security";
import type { ResultMessage, SeparateRequest, WorkerOutMessage } from "./worker-protocol";
import { buildZip, zipBlob } from "./zip";

// --- tiny DOM builder, used everywhere instead of innerHTML (R-06/T-024) ---
type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) node.append(child);
  return node;
}

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function formatMinutesRange(lowSeconds: number, highSeconds: number): string {
  const fmt = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${(s / 60).toFixed(1)} min`);
  return `${fmt(lowSeconds)}\u2013${fmt(highSeconds)}`;
}

/** Rough, clearly-labelled estimate from the SP-2 reference machine
 * (research/spikes/SP-2.md): ~1.3s/chunk on WebGPU, ~22s/chunk on 3-thread
 * WASM, for a 4-minute (42-chunk) song. Real hardware varies a lot — this is
 * a ballpark, not a promise. */
function estimateSeparationSeconds(durationSeconds: number, mode: SeparationMode, hasWebgpu: boolean): [number, number] {
  const chunkCount = Math.max(1, Math.ceil(durationSeconds / (257_985 / 44_100)));
  const perChunk: [number, number] = hasWebgpu ? [0.9, 2] : [15, 30];
  const modelMultiplier = mode === "hq" ? 4 : 1;
  const modelLoadOverhead = (hasWebgpu ? 48 : 27) * modelMultiplier;
  return [
    chunkCount * perChunk[0] * modelMultiplier + modelLoadOverhead,
    chunkCount * perChunk[1] * modelMultiplier + modelLoadOverhead,
  ];
}

interface StemDownload {
  stem: StemName;
  blob: Blob;
  url: string;
}

type Stage = "idle" | "decoding" | "ready" | "running" | "done" | "error";

export class App {
  private readonly root: HTMLElement;
  private worker: Worker | null = null;
  private stage: Stage = "idle";

  private file: File | null = null;
  private fileSha256 = "";
  private decoded: { left: Float32Array; right: Float32Array; sampleCount: number } | null = null;
  private durationWarning = false;
  private mode: SeparationMode = "standard";
  private hasWebgpu = false;
  private slowMode = false;
  private isIOSDevice = false;

  private stemDownloads: StemDownload[] = [];
  private provenanceUrl: string | null = null;
  private zipUrl: string | null = null;
  private lastProvenance: Provenance | null = null;

  // Elements rebuilt on each render() call.
  private els!: {
    notices: HTMLElement;
    dropzone: HTMLElement;
    fileInput: HTMLInputElement;
    modeFieldset: HTMLFieldSetElement;
    actions: HTMLElement;
    progress: HTMLElement;
    results: HTMLElement;
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.hasWebgpu = false; // resolved async below, then re-rendered
    this.slowMode = typeof self !== "undefined" && !self.crossOriginIsolated;
    this.isIOSDevice = isIOS();
    this.render();
    void webgpuAvailable().then((ok) => {
      this.hasWebgpu = ok;
      this.render();
    });
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.render();
  }

  // --- rendering -----------------------------------------------------

  private render(): void {
    this.root.replaceChildren();

    const header = el("header", {}, [
      el("h1", {}, ["Stem Splitter"]),
      el("p", { class: "tagline" }, [
        "Split a song into vocals, drums, bass and other \u2014 entirely in your browser.",
      ]),
    ]);

    const notices = el("div", {});
    const dropzoneArea = this.buildDropzone();
    const modeFieldset = this.buildModeSelector();
    const actions = el("div", { class: "actions" });
    const progress = el("div", {});
    const results = el("div", {});

    this.els = {
      notices,
      dropzone: dropzoneArea,
      fileInput: dropzoneArea.querySelector("input[type=file]") as HTMLInputElement,
      modeFieldset,
      actions,
      progress,
      results,
    };

    const card = el("div", { class: "card" }, [dropzoneArea, modeFieldset, actions, progress]);

    this.root.append(
      header,
      notices,
      card,
      results,
      el("p", { class: "notice info" }, [
        "Nothing you upload here is sent anywhere \u2014 the audio is decoded and separated entirely on your device, using a model downloaded once and cached by your browser.",
      ]),
      el("footer", {}, [
        "Uses ",
        el("a", { href: "https://github.com/StemSplitio", target: "_blank", rel: "noreferrer" }, ["demucs-onnx"]),
        " (HT-Demucs). Source: ",
        el("a", { href: "https://github.com/qualitycoding/stem-splitter", target: "_blank", rel: "noreferrer" }, [
          "qualitycoding/stem-splitter",
        ]),
        ".",
      ]),
    );

    this.renderNotices();
    this.renderActions();
    this.renderProgress();
    this.renderResults();
  }

  private renderNotices(): void {
    this.els.notices.replaceChildren();
    if (this.slowMode) {
      this.els.notices.append(
        el("p", { class: "notice warn" }, [
          "Running in single-threaded mode because full browser isolation isn't available here \u2014 separation will be slower than usual.",
        ]),
      );
    }
    if (this.isIOSDevice) {
      this.els.notices.append(
        el("p", { class: "notice warn" }, [
          "On iOS/iPadOS, only Standard mode is available, and very long tracks may run out of memory.",
        ]),
      );
    }
    if (this.durationWarning && (this.stage === "ready" || this.stage === "idle")) {
      this.els.notices.append(
        el("p", { class: "notice warn" }, [
          "This track is over 5 minutes \u2014 separation may take a while, especially without a GPU.",
        ]),
      );
    }
  }

  private buildDropzone(): HTMLElement {
    const fileInput = el("input", {
      type: "file",
      accept: "audio/*",
      onchange: (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void this.handleFile(f);
      },
    }) as HTMLInputElement;

    const label = this.file
      ? el("p", { class: "filename" }, [this.file.name])
      : el("p", {}, ["Drop an audio file here, or click to choose one"]);

    const zone = el(
      "div",
      {
        class: "dropzone",
        onclick: () => fileInput.click(),
        ondragover: (e) => {
          e.preventDefault();
          zone.classList.add("drag-over");
        },
        ondragleave: () => zone.classList.remove("drag-over"),
        ondrop: (e) => {
          e.preventDefault();
          zone.classList.remove("drag-over");
          const f = (e as DragEvent).dataTransfer?.files?.[0];
          if (f) void this.handleFile(f);
        },
      },
      [
        fileInput,
        label,
        el("p", {}, [`MP3, WAV, FLAC, OGG \u2014 up to ${formatBytes(MAX_FILE_BYTES)}, ${MAX_DURATION_SECONDS / 60} min`]),
      ],
    );
    return zone;
  }

  private buildModeSelector(): HTMLFieldSetElement {
    const hqDisabled = !this.hasWebgpu || this.isIOSDevice;
    const hqReason = this.isIOSDevice
      ? "Not available on iOS/iPadOS."
      : !this.hasWebgpu
        ? "Needs WebGPU, which isn't available in this browser \u2014 it would take roughly an hour without it."
        : "";

    const makeOption = (value: SeparationMode, title: string, detail: string, disabled: boolean): HTMLElement =>
      el("div", { class: `mode-option${disabled ? " disabled" : ""}` }, [
        el("input", {
          type: "radio",
          name: "mode",
          id: `mode-${value}`,
          value,
          checked: this.mode === value,
          disabled,
          onchange: () => {
            this.mode = value;
            this.render();
          },
        }),
        el("label", { for: `mode-${value}` }, [
          el("div", { class: "mode-title" }, [title]),
          el("div", { class: "mode-detail" }, [detail]),
        ]),
      ]);

    return el("fieldset", {}, [
      el("legend", {}, ["Quality"]),
      makeOption("standard", "Standard", "One model, all four stems. Works everywhere.", false),
      makeOption(
        "hq",
        "High quality",
        hqDisabled ? hqReason : "A specialist model per stem \u2014 slower, often cleaner separation.",
        hqDisabled,
      ),
    ]);
  }

  private renderActions(): void {
    this.els.actions.replaceChildren();
    if (this.stage === "ready") {
      const estimate = this.decoded
        ? estimateSeparationSeconds(this.decoded.sampleCount / 44_100, this.mode, this.hasWebgpu)
        : null;
      this.els.actions.append(
        el(
          "button",
          { class: "primary", onclick: () => this.startSeparation() },
          ["Split it", ...(estimate ? [` (about ${formatMinutesRange(estimate[0], estimate[1])})`] : [])],
        ),
      );
    } else if (this.stage === "running") {
      this.els.actions.append(el("button", { onclick: () => this.cancelSeparation() }, ["Cancel"]));
    } else if (this.stage === "done" || this.stage === "error") {
      this.els.actions.append(el("button", { onclick: () => this.reset() }, ["Start over"]));
    }
  }

  private renderProgress(): void {
    this.els.progress.replaceChildren();
    if (this.stage === "decoding") {
      this.els.progress.append(el("p", { class: "status-line" }, ["Decoding audio\u2026"]));
    }
  }

  private renderResults(): void {
    this.els.results.replaceChildren();
    if (this.stage !== "done" || this.stemDownloads.length === 0) return;

    const rows = this.stemDownloads.map((s) =>
      el("div", { class: "stem-row" }, [
        el("span", { class: "stem-name" }, [s.stem]),
        el("a", { href: s.url, download: `${s.stem}.wav` }, ["Download .wav"]),
      ]),
    );

    const buttons: HTMLElement[] = [
      el(
        "button",
        {
          class: "primary",
          onclick: () => this.downloadAll(),
        },
        ["Download all (.zip)"],
      ),
    ];
    if (this.provenanceUrl) {
      buttons.push(el("a", { href: this.provenanceUrl, download: "provenance.json" }, ["provenance.json"]));
    }

    this.els.results.append(
      el("div", { class: "card" }, [
        el("div", { class: "stems" }, rows),
        el("div", { class: "actions", style: "margin-top: 0.75rem;" }, buttons),
      ]),
    );
  }

  // --- file handling ---------------------------------------------------

  private async handleFile(file: File): Promise<void> {
    this.cleanupObjectUrls();
    this.file = file;
    this.decoded = null;
    this.durationWarning = false;
    this.setStage("decoding");

    try {
      checkFileSize(file);
      const [hash, decoded] = await Promise.all([sha256Hex(await file.arrayBuffer()), decodeTo44k(file)]);
      const { warn } = checkDuration(decoded.sampleCount, 44_100);
      this.fileSha256 = hash;
      this.decoded = decoded;
      this.durationWarning = warn;
      this.setStage("ready");
    } catch (err) {
      this.showFileError(err);
      this.setStage("idle");
    }
  }

  private showFileError(err: unknown): void {
    const message =
      err instanceof FileTooLargeError || err instanceof AudioTooLongError || err instanceof AudioInputError
        ? err.message
        : "Something went wrong reading that file.";
    this.els.notices.append(el("p", { class: "notice error" }, [message]));
  }

  // --- separation --------------------------------------------------------

  private startSeparation(): void {
    if (!this.decoded || !this.file) return;
    this.setStage("running");

    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    worker.addEventListener("message", (e: MessageEvent<WorkerOutMessage>) => this.onWorkerMessage(e.data));
    worker.addEventListener("error", () => {
      this.els.notices.append(
        el("p", { class: "notice error" }, ["The separation worker crashed. Try a shorter file or reload the page."]),
      );
      this.setStage("error");
    });

    const request: SeparateRequest = {
      type: "separate",
      left: this.decoded.left,
      right: this.decoded.right,
      mode: this.mode,
      fileName: this.file.name,
      fileSha256: this.fileSha256,
    };
    worker.postMessage(request, [request.left.buffer, request.right.buffer]);
    // The transferred buffers are now neutered on this side; decoded audio
    // isn't needed again on the main thread after this point.
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private cancelSeparation(): void {
    // No graceful cancel-message handshake: terminate() is immediate and
    // guarantees the worker (and whatever WASM memory its ORT session
    // holds) is actually gone, which matters more here than letting an
    // in-flight chunk finish cleanly.
    this.terminateWorker();
    this.setStage("ready");
  }

  private onWorkerMessage(message: WorkerOutMessage): void {
    if (message.type === "progress") {
      this.renderProgressMessage(message.stage, message.completed, message.total);
      return;
    }
    if (message.type === "result") {
      this.terminateWorker();
      this.buildResultDownloads(message);
      this.setStage("done");
      return;
    }
    if (message.type === "error") {
      this.terminateWorker();
      this.els.notices.append(el("p", { class: "notice error" }, [message.message || "Separation failed."]));
      this.setStage("error");
      return;
    }
    if (message.type === "cancelled") {
      this.terminateWorker();
      this.setStage("ready");
    }
  }

  private renderProgressMessage(stage: string, completed: number, total: number): void {
    this.els.progress.replaceChildren();
    const label =
      stage === "loading-model"
        ? `Downloading model\u2026 ${formatBytes(completed)} / ${total ? formatBytes(total) : "?"}`
        : stage === "preparing-model"
          ? "Preparing model\u2026 (this can take up to a minute)"
          : `Separating\u2026 chunk ${completed} / ${total}`;
    const pct = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
    const indeterminate = stage === "preparing-model";
    this.els.progress.append(
      el("div", { class: "progress-track" }, [
        el("div", {
          class: `progress-fill${indeterminate ? " indeterminate" : ""}`,
          style: indeterminate ? "" : `width: ${pct}%`,
        }),
      ]),
      el("p", { class: "status-line" }, [label]),
    );
  }

  private buildResultDownloads(message: ResultMessage): void {
    this.cleanupObjectUrls();
    this.stemDownloads = message.stems.map((s) => {
      const blob = wavBlob(encodeWavPCM16(s.left, s.right));
      return { stem: s.stem, blob, url: URL.createObjectURL(blob) };
    });
    const pBlob = provenanceBlob(message.provenance);
    this.provenanceUrl = URL.createObjectURL(pBlob);
    this.lastProvenance = message.provenance;

    const badge = ` \u2014 ${message.provenance.executionProvider.toUpperCase()}${
      message.provenance.threadCount > 1 ? `, ${message.provenance.threadCount} threads` : ""
    }`;
    this.els.notices.append(el("p", { class: "notice ok" }, [`Done${badge}`]));
  }

  private downloadAll(): void {
    if (this.stemDownloads.length === 0 || !this.lastProvenance) return;
    const provenance = this.lastProvenance;
    void (async () => {
      const zipEntries = await Promise.all(
        this.stemDownloads.map(async (s) => ({
          name: `${s.stem}.wav`,
          data: new Uint8Array(await s.blob.arrayBuffer()),
        })),
      );
      zipEntries.push({
        name: "provenance.json",
        data: new Uint8Array(await provenanceBlob(provenance).arrayBuffer()),
      });
      const bytes = buildZip(zipEntries);
      const blob = zipBlob(bytes);
      if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
      this.zipUrl = URL.createObjectURL(blob);
      const a = el("a", { href: this.zipUrl, download: "stems.zip" });
      document.body.append(a);
      a.click();
      a.remove();
    })();
  }

  // --- reset / cleanup -----------------------------------------------

  private cleanupObjectUrls(): void {
    for (const s of this.stemDownloads) URL.revokeObjectURL(s.url);
    this.stemDownloads = [];
    if (this.provenanceUrl) {
      URL.revokeObjectURL(this.provenanceUrl);
      this.provenanceUrl = null;
    }
    if (this.zipUrl) {
      URL.revokeObjectURL(this.zipUrl);
      this.zipUrl = null;
    }
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.cleanupObjectUrls();
    this.file = null;
    this.decoded = null;
    this.durationWarning = false;
    this.lastProvenance = null;
    this.setStage("idle");
  }
}

// Re-export for tests that want the pure estimate function without a DOM.
export { estimateSeparationSeconds, formatMinutesRange };
export type { StemName };
