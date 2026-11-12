import { afterEach, describe, expect, it, vi } from "vitest";
import { browserMeasure, sizeOk } from "./measure";

describe("sizeOk", () => {
  it("drops blanks, small, square and wide images; keeps a portrait cover", () => {
    expect(sizeOk({ width: 1, height: 1 })).toBe(false);
    expect(sizeOk({ width: 200, height: 300 })).toBe(false);
    expect(sizeOk({ width: 400, height: 400 })).toBe(false);
    expect(sizeOk({ width: 400, height: 1000 })).toBe(false);
    expect(sizeOk({ width: 300, height: 450 })).toBe(true);
  });
});

type FakeImg = {
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

function stubImage(behave: (img: FakeImg) => void) {
  class FakeImage implements FakeImg {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      behave(this);
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

describe("browserMeasure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves the natural size on load", async () => {
    stubImage((img) => {
      img.naturalWidth = 300;
      img.naturalHeight = 450;
      queueMicrotask(() => img.onload?.());
    });
    await expect(browserMeasure("https://covers.openlibrary.org/b/id/1000001-L.jpg")).resolves.toEqual({
      width: 300,
      height: 450,
    });
  });

  it("resolves null on error", async () => {
    stubImage((img) => queueMicrotask(() => img.onerror?.()));
    await expect(browserMeasure("https://covers.openlibrary.org/b/id/1000001-L.jpg")).resolves.toBeNull();
  });

  it("resolves null when nothing loads within 8 s", async () => {
    vi.useFakeTimers();
    stubImage(() => {});
    const p = browserMeasure("https://covers.openlibrary.org/b/id/1000001-L.jpg");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBeNull();
  });
});
