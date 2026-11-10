import type { Decoder } from "./decoder";
import { DECODE_GAP_MS } from "./read-gate";

/** The only way to reach decoder.ts, so zxing-wasm and its .wasm load when the camera starts (D1). */
export function loadDecoder(): Promise<Decoder> {
  return import("./decoder").then((m) => m.createDecoder());
}

export interface ScanLoopOptions {
  grab(): ImageData | null;
  decoder: Decoder;
  onText(text: string): void;
  gapMs?: number;
  signal: AbortSignal;
  sleep?(ms: number): Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** Sequential: grab, decode, report each text, then wait the gap. Decodes never overlap (D4). */
export async function runScanLoop(opts: ScanLoopOptions): Promise<void> {
  const { grab, decoder, onText, gapMs = DECODE_GAP_MS, signal } = opts;
  const sleep = opts.sleep ?? ((ms: number) => abortableSleep(ms, signal));
  while (!signal.aborted) {
    const frame = grab();
    if (frame) {
      try {
        const texts = await decoder.decode(frame);
        for (const text of texts) {
          if (signal.aborted) return;
          onText(text);
        }
      } catch (err) {
        console.error("Barcode decode failed", err instanceof Error ? err.name : "unknown");
      }
    }
    if (signal.aborted) return;
    await sleep(gapMs);
  }
}
