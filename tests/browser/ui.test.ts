import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/ui";

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

describe("App startup (T-019)", () => {
  it("renders the shell immediately, with no file chosen and no model downloaded", () => {
    container = document.createElement("div");
    document.body.append(container);

    new App(container);

    expect(container.querySelector("h1")?.textContent).toBe("Stem Splitter");
    expect(container.querySelector(".dropzone")).toBeTruthy();
    expect(container.querySelector("input[type=file]")).toBeTruthy();
    // No progress bar, no results, no error notices before any file is chosen.
    expect(container.querySelector(".progress-track")).toBeNull();
    expect(container.querySelector(".stem-row")).toBeNull();
    expect(container.querySelector(".notice.error")).toBeNull();
  });

  it("mode selector is interactive without requiring a model download first", () => {
    container = document.createElement("div");
    document.body.append(container);

    new App(container);

    const standard = container.querySelector<HTMLInputElement>("#mode-standard");
    expect(standard).toBeTruthy();
    expect(standard?.checked).toBe(true);
  });
});
