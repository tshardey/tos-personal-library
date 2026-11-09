import { describe, expect, it, vi } from "vitest";
import { fitWithin, PhotoError, preparePhoto, type ImageDeps } from "./prepare";

const MIB = 1024 * 1024;

function makeDeps(opts: { width?: number; height?: number; decodeError?: boolean; sizes?: number[] }) {
  const close = vi.fn();
  const encodeCalls: { w: number; h: number; q: number }[] = [];
  const sizes = [...(opts.sizes ?? [1000])];
  const deps: ImageDeps = {
    decode: vi.fn(async () => {
      if (opts.decodeError) throw new Error("cannot decode");
      return { width: opts.width ?? 4032, height: opts.height ?? 3024, close };
    }),
    encode: vi.fn(async (_b, w, h, q) => {
      encodeCalls.push({ w, h, q });
      return new Blob([new Uint8Array(sizes.shift() ?? 1000)], { type: "image/jpeg" });
    }),
    sha256Hex: vi.fn(async (bytes: ArrayBuffer) => `h${new Uint8Array(bytes).length}-${new Uint8Array(bytes)[0]}`),
  };
  return { deps, close, encodeCalls };
}

const file = (bytes: number[]) => new File([new Uint8Array(bytes)], "x.jpg", { type: "image/jpeg" });

describe("fitWithin", () => {
  it("scales the long edge down to max", () => {
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
  });
  it("never upscales", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe("preparePhoto", () => {
  it("hashes the original bytes, so different encodings share a hash", async () => {
    const a = makeDeps({ sizes: [500] });
    const b = makeDeps({ sizes: [900] });
    const f = file([7, 8, 9]);
    const r1 = await preparePhoto(f, a.deps);
    const r2 = await preparePhoto(f, b.deps);
    expect(r1.sourceHash).toBe("h3-7");
    expect(r2.sourceHash).toBe(r1.sourceHash);
    expect(r1.blob.size).not.toBe(r2.blob.size);
  });

  it("encodes at 0.85 at the fitted size and closes the bitmap", async () => {
    const { deps, close, encodeCalls } = makeDeps({});
    await preparePhoto(file([1]), deps);
    expect(encodeCalls).toEqual([{ w: 1280, h: 960, q: 0.85 }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retries once at 0.7 when over 2 MiB", async () => {
    const { deps, encodeCalls } = makeDeps({ sizes: [2 * MIB + 1, 1000] });
    const r = await preparePhoto(file([1]), deps);
    expect(encodeCalls.map((c) => c.q)).toEqual([0.85, 0.7]);
    expect(r.blob.size).toBe(1000);
  });

  it("throws too_large when the second encode is still over, and closes", async () => {
    const { deps, close } = makeDeps({ sizes: [2 * MIB + 1, 2 * MIB + 1] });
    await expect(preparePhoto(file([1]), deps)).rejects.toMatchObject({ code: "too_large" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("throws unreadable when decode rejects", async () => {
    const { deps } = makeDeps({ decodeError: true });
    const err = await preparePhoto(file([1]), deps).catch((e) => e);
    expect(err).toBeInstanceOf(PhotoError);
    expect(err.code).toBe("unreadable");
  });

  it("throws too_small for a short edge under 200, and closes", async () => {
    const { deps, close } = makeDeps({ width: 150, height: 900 });
    await expect(preparePhoto(file([1]), deps)).rejects.toMatchObject({ code: "too_small" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(deps.encode).not.toHaveBeenCalled();
  });

  it("closes the bitmap when encode fails", async () => {
    const { deps, close } = makeDeps({});
    deps.encode = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(preparePhoto(file([1]), deps)).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
