const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('desktop and generated icons use the original terminal prompt mark', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const generator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generate-icon.mjs'), 'utf8');
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');

  assert.match(renderer, /class="brand-mark"[^>]*>&rsaquo;_<\/div>/);
  assert.match(generator, /const GLYPH_SEGMENTS/);
  assert.doesNotMatch(generator, /MOUTH_CURVES|EYES_AND_TOP/);
  assert.match(svg, /m154 204 64 52-64 52M245 307h88/);
});
