import { describe, expect, it, vi } from "vitest";

const reader = vi.hoisted(() => ({
  prepareZXingModule: vi.fn(async () => ({})),
  readBarcodes: vi.fn(),
}));
vi.mock("zxing-wasm/reader", () => reader);

import { createDecoder, READER_OPTIONS } from "./decoder";

describe("decoder (D1)", () => {
  it("pins the D1 reader options", () => {
    expect(READER_OPTIONS).toEqual({
      formats: ["EANUPC"],
      eanAddOnSymbol: "Ignore",
      maxNumberOfSymbols: 1,
      tryHarder: true,
    });
  });

  it("self-hosts the wasm and returns only valid texts", async () => {
    reader.readBarcodes.mockResolvedValue([
      { isValid: true, format: "ISBN", text: "9780000000002" },
      { isValid: false, format: "EAN13", text: "9780000000003" },
    ]);
    const decoder = await createDecoder();
    const frame = {} as ImageData;
    await expect(decoder.decode(frame)).resolves.toEqual(["9780000000002"]);
    expect(reader.readBarcodes).toHaveBeenCalledWith(frame, READER_OPTIONS);

    expect(reader.prepareZXingModule).toHaveBeenCalledTimes(1);
    const opts = (reader.prepareZXingModule.mock.calls[0] as unknown as [
      { overrides: { locateFile(path: string, prefix: string): string }; fireImmediately: boolean },
    ])[0];
    expect(opts.fireImmediately).toBe(true);
    const wasm = opts.overrides.locateFile("zxing_reader.wasm", "https://cdn.example/");
    expect(wasm).toMatch(/zxing_reader.*\.wasm/);
    expect(wasm.startsWith("https://cdn.example/")).toBe(false);
    expect(opts.overrides.locateFile("other.js", "/p/")).toBe("/p/other.js");

    await createDecoder();
    expect(reader.prepareZXingModule).toHaveBeenCalledTimes(1);
  });
});
