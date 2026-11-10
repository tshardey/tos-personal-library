import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

/**
 * D1. EANUPC rather than EAN13: in 3.x a 978/979 barcode may come back as the read-only ISBN
 * format. Add-ons are ignored; every text still goes through isbnFromBarcode at the caller.
 */
export const READER_OPTIONS = {
  formats: ["EANUPC"],
  eanAddOnSymbol: "Ignore",
  maxNumberOfSymbols: 1,
  tryHarder: true,
} satisfies ReaderOptions;

export interface Decoder {
  /** Texts of the valid results (any EAN/UPC format); the caller filters them (D1). */
  decode(frame: ImageData): Promise<string[]>;
}

let ready: Promise<unknown> | null = null;

/** Only ever reached through `import("./decoder")` in loadDecoder(), so the WASM stays out of the entry chunk. */
export async function createDecoder(): Promise<Decoder> {
  // Self-hosted: Vite emits the .wasm as a hashed asset on our own origin instead of jsDelivr.
  ready ??= prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
  try {
    await ready;
  } catch (err) {
    ready = null;
    throw err;
  }
  return {
    async decode(frame) {
      const results = await readBarcodes(frame, READER_OPTIONS);
      return results.filter((r) => r.isValid).map((r) => r.text);
    },
  };
}
