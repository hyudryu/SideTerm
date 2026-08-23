import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ">ω<" face: squeezed ">" "<" eyes with a curvy two-lobed cat mouth.
// Geometry is authored on a 512 grid and scaled per render size.
// Keep in sync with build/icon.svg.
const EYES_AND_TOP = [
  [138, 194, 190, 236], [190, 236, 138, 278],
  [374, 194, 322, 236], [322, 236, 374, 278]
];
const MOUTH_CURVES = [
  [[224, 298], [224, 330], [254, 332], [256, 304]],
  [[256, 304], [258, 332], [288, 330], [288, 298]]
];
const GLYPH_STROKE = 24;

function glyphSegments() {
  const segments = [...EYES_AND_TOP];
  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1]
    ];
  };
  for (const [p0, p1, p2, p3] of MOUTH_CURVES) {
    for (let i = 0; i < 12; i += 1) {
      segments.push([...cubic(p0, p1, p2, p3, i / 12), ...cubic(p0, p1, p2, p3, (i + 1) / 12)]);
    }
  }
  return segments;
}

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

function renderPng(size) {
  const scale = size / 512;
  const bytesPerPixel = 4;
  const pixels = Buffer.alloc((size * bytesPerPixel + 1) * size);
  const segments = glyphSegments().map((segment) => segment.map((value) => value * scale));
  const strokeWidth = GLYPH_STROKE * scale;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * bytesPerPixel + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * bytesPerPixel;
      const distance = roundedRectDistance(x, y, 30 * scale, 30 * scale, 482 * scale, 482 * scale, 92 * scale);
      if (distance <= 0) {
        const blend = (x + y) / (size * 2);
        pixels[offset] = Math.round(24 + blend * 68);
        pixels[offset + 1] = Math.round(116 - blend * 50);
        pixels[offset + 2] = Math.round(183 + blend * 40);
        pixels[offset + 3] = 255;
      }

      const terminalPanel = roundedRectDistance(x, y, 92 * scale, 112 * scale, 420 * scale, 400 * scale, 30 * scale);
      if (terminalPanel <= 0) {
        pixels[offset] = 14;
        pixels[offset + 1] = 15;
        pixels[offset + 2] = 18;
        pixels[offset + 3] = 245;
      }

      const onGlyph = segments.some(([ax, ay, bx, by]) => inStroke(x, y, ax, ay, bx, by, strokeWidth));
      if (onGlyph) {
        pixels[offset] = 242;
        pixels[offset + 1] = 247;
        pixels[offset + 2] = 251;
        pixels[offset + 3] = 255;
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
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

// Windows .ico with PNG-compressed frames (valid since Vista).
function buildIco(sizes) {
  const frames = sizes.map((size) => ({ size, png: renderPng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = Buffer.alloc(16 * frames.length);
  let offset = 6 + entries.length;
  frames.forEach((frame, index) => {
    const entry = index * 16;
    entries[entry] = frame.size >= 256 ? 0 : frame.size;
    entries[entry + 1] = frame.size >= 256 ? 0 : frame.size;
    entries[entry + 2] = 0;
    entries[entry + 3] = 0;
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(frame.png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += frame.png.length;
  });
  return Buffer.concat([header, entries, ...frames.map((frame) => frame.png)]);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(scriptDir, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(pngPath, renderPng(512));
fs.writeFileSync(icoPath, buildIco([16, 24, 32, 48, 64, 128, 256]));
console.log(`Generated ${pngPath}`);
console.log(`Generated ${icoPath}`);
