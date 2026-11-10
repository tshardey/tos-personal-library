// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule as prepareReader, readBarcodes } from "zxing-wasm/reader";
import { prepareZXingModule as prepareWriter, writeBarcode } from "zxing-wasm/writer";
import { READER_OPTIONS } from "./decoder";
import { isbnFromBarcode } from "./isbn-input";

// The real WASM, loaded from node_modules (I1). Barcode images are generated here, never committed.
function wasm(kind: "reader" | "writer"): ArrayBuffer {
  const buf = readFileSync(resolve(process.cwd(), `node_modules/zxing-wasm/dist/${kind}/zxing_${kind}.wasm`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

beforeAll(async () => {
  await prepareWriter({ overrides: { wasmBinary: wasm("writer") }, fireImmediately: true });
  await prepareReader({ overrides: { wasmBinary: wasm("reader") }, fireImmediately: true });
});

async function writeAndRead(text: string, format: "EAN13" | "UPCA") {
  const written = await writeBarcode(text, { format, scale: 3 });
  expect(written.error).toBe("");
  expect(written.image).not.toBeNull();
  const png = new Uint8Array(await written.image!.arrayBuffer());
  expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  return readBarcodes(png, READER_OPTIONS);
}

describe("zxing-wasm 3.1.6 with READER_OPTIONS (D1)", () => {
  it.each(["9780000000002", "9791000000008"])("reads a written EAN-13 ISBN %s", async (isbn) => {
    const results = await writeAndRead(isbn, "EAN13");
    expect(results).toHaveLength(1);
    const [r] = results;
    console.info(`zxing format for ${isbn}: ${r.format}`);
    expect(r.isValid).toBe(true);
    expect(r.text).toBe(isbn);
    expect(["EAN13", "ISBN"]).toContain(r.format);
    expect(isbnFromBarcode(r.text)).toEqual({ kind: "isbn", isbn13: isbn });
  });

  it("reads a written UPC-A, which isbnFromBarcode rejects", async () => {
    const results = await writeAndRead("012345678905", "UPCA");
    expect(results).toHaveLength(1);
    console.info(`zxing format for UPC-A: ${results[0].format} text ${results[0].text}`);
    expect(results[0].isValid).toBe(true);
    expect(isbnFromBarcode(results[0].text)).toEqual({ kind: "not_isbn" });
  });
});
