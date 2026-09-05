// Deterministic, brand-neutral 1200 x 628 RGB PNG; no imaging dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const width = 1200;
const height = 628;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const paper = x >= 170 && x < 1030 && y >= 100 && y < 528;
    const rule = paper && x >= 220 && x < 980 && (y === 165 || y === 166 || y === 464);
    const column = paper && y >= 215 && y < 420 && (y - 215) % 34 < 7 &&
      ((x >= 220 && x < 565) || (x >= 620 && x < 980));
    const color = rule ? [70, 80, 90] : column ? [204, 208, 211] : paper ? [253, 252, 249] : [235, 238, 240];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels.set(color, offset);
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
writeFileSync(new URL("../public/og-default.png", import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(pixels, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]));
