import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

/**
 * EAN-13 barcode images for the fake camera, rendered in Node at test time with zxing-wasm's own
 * writer. Nothing here is ever written to disk: the repo is public and holds no barcode images.
 */

let ready: Promise<unknown> | null = null;
const cache = new Map<string, string>();

function writerWasm(): ArrayBuffer {
  const buf = readFileSync(resolve(process.cwd(), "node_modules/zxing-wasm/dist/writer/zxing_writer.wasm"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A PNG data URL of the EAN-13 barcode for `digits` (13 digits, valid checksum). */
export async function barcodePng(digits: string): Promise<string> {
  const hit = cache.get(digits);
  if (hit) return hit;
  ready ??= prepareZXingModule({ overrides: { wasmBinary: writerWasm() }, fireImmediately: true });
  await ready;
  const written = await writeBarcode(digits, { format: "EAN13", scale: 3 });
  if (written.error || !written.image) throw new Error(`barcode writer failed: ${written.error}`);
  const png = Buffer.from(await written.image.arrayBuffer());
  const url = `data:image/png;base64,${png.toString("base64")}`;
  cache.set(digits, url);
  return url;
}

// EAN-13 bar patterns, for the one barcode the writer refuses to draw: a wrong check digit.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/**
 * An SVG data URL of the EAN-13 bars for `digits` exactly as given, check digit included, valid
 * or not. Used only for the bad-checksum fixture, which a correct reader must never accept.
 */
export function rawEan13Svg(digits: string): string {
  if (!/^\d{13}$/.test(digits)) throw new Error("13 digits expected");
  const d = digits.split("").map(Number);
  let bits = "101";
  const parity = PARITY[d[0]];
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += "101";
  const quiet = 11;
  const width = bits.length + quiet * 2;
  const rects = [...bits]
    .map((b, i) => (b === "1" ? `<rect x="${i + quiet}" y="0" width="1" height="40"/>` : ""))
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 3}" height="120" viewBox="0 0 ${width} 40" ` +
    `shape-rendering="crispEdges"><rect width="${width}" height="40" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
