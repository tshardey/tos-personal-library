// One-off dev script: node scripts/generate-icons.mjs  (no deps; not part of the bundle)
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0x29, 0x25, 0x24]; // stone-800
const FG = [0xf5, 0xf5, 0xf4]; // stone-100
const INK = [0xa8, 0xa2, 0x9e]; // stone-400

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Glyph lives inside the central ~60% so it is safe for maskable use.
function pixel(x, y) {
  if (!inRect(x, y, 0.27, 0.2, 0.73, 0.8)) return BG;
  if (inRect(x, y, 0.27, 0.2, 0.34, 0.8)) return INK; // spine
  if (inRect(x, y, 0.42, 0.3, 0.65, 0.34)) return INK; // title lines
  if (inRect(x, y, 0.42, 0.4, 0.58, 0.43)) return INK;
  if (inRect(x, y, 0.27, 0.74, 0.73, 0.8)) return INK; // page edge
  return FG;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set(p, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["maskable-512", 512]])
  writeFileSync(`public/icons/${name}.png`, png(size));
