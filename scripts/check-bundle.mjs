// Bundle check for the barcode scanner (D1). Run after `npm run build`:
//   docker compose run --rm app sh -c "npm run build && npm run check:bundle"
// Fails if the entry chunk mentions zxing, or if the self-hosted zxing_reader-*.wasm is missing.
// Prints the entry, scan route, decoder chunk and .wasm sizes (raw and gzip).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = "dist";
const assets = join(dist, "assets");
// kB = 1000 bytes, as Vite and D1 report them.
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
const failures = [];

function sizes(file) {
  const buf = readFileSync(join(assets, file));
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, text: buf.toString("utf8") };
}

const html = readFileSync(join(dist, "index.html"), "utf8");
const entryMatch = /<script[^>]+type="module"[^>]+src="[^"]*\/assets\/([^"]+\.js)"/.exec(html);
if (!entryMatch) {
  console.error("No entry script found in dist/index.html.");
  process.exit(1);
}
const entryFile = entryMatch[1];
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith(".js"));

const entry = sizes(entryFile);
if (/zxing/i.test(entry.text)) failures.push(`the entry chunk ${entryFile} mentions zxing`);

const wasm = files.filter((f) => /^zxing_reader-.+\.wasm$/.test(f));
if (wasm.length !== 1) failures.push(`expected one zxing_reader-*.wasm asset, found ${wasm.length}`);

// The scan route chunk is the one with the scanner's own copy; the decoder chunk loads the reader.
const scanFile = js.find((f) => f !== entryFile && sizes(f).text.includes("Start scanning"));
const decoderFile = js.find((f) => f !== entryFile && f !== scanFile && /zxing_reader/.test(sizes(f).text));
if (!scanFile) failures.push("no scan route chunk found");
if (!decoderFile) failures.push("no decoder chunk found");

const row = (label, file) => {
  if (!file) return;
  const s = sizes(file);
  console.log(`${label.padEnd(8)} ${file.padEnd(36)} ${kb(s.raw).padStart(10)} raw ${kb(s.gzip).padStart(10)} gzip`);
};
row("entry", entryFile);
row("scan", scanFile);
row("decoder", decoderFile);
for (const w of wasm) row("wasm", w);

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log("OK: the entry chunk has no zxing, and the reader .wasm is self-hosted.");
