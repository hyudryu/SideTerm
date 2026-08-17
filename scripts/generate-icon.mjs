import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const size = 512;
const bytesPerPixel = 4;
const pixels = Buffer.alloc((size * bytesPerPixel + 1) * size);

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return Math.hypot(x - cx, y - cy) - radius;
}

function inStroke(x, y, ax, ay, bx, by, width) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(x - (ax + t * abx), y - (ay + t * aby)) <= width / 2;
}

for (let y = 0; y < size; y += 1) {
  const row = y * (size * bytesPerPixel + 1);
  pixels[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * bytesPerPixel;
    const distance = roundedRectDistance(x, y, 30, 30, 482, 482, 92);
    if (distance <= 0) {
      const blend = (x + y) / (size * 2);
      pixels[offset] = Math.round(24 + blend * 68);
      pixels[offset + 1] = Math.round(116 - blend * 50);
      pixels[offset + 2] = Math.round(183 + blend * 40);
      pixels[offset + 3] = 255;
    }

    const terminalPanel = roundedRectDistance(x, y, 92, 112, 420, 400, 30);
    if (terminalPanel <= 0) {
      pixels[offset] = 14;
      pixels[offset + 1] = 15;
      pixels[offset + 2] = 18;
      pixels[offset + 3] = 245;
    }

    const chevron = inStroke(x, y, 154, 204, 218, 256, 24) || inStroke(x, y, 218, 256, 154, 308, 24);
    const underscore = inStroke(x, y, 245, 307, 333, 307, 22);
    if (chevron || underscore) {
      pixels[offset] = 242;
      pixels[offset + 1] = 247;
      pixels[offset + 2] = 251;
      pixels[offset + 3] = 255;
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(scriptDir, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);
console.log(`Generated ${output}`);
