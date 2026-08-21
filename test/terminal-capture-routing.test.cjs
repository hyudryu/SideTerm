const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('visual inspection captures the styled live terminal and preserves fallback routing', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /requestRendererAction\('prepare-terminal-capture'/);
  assert.match(main, /webContents\.capturePage\(bounds\)/);
  assert.doesNotMatch(main, /forceVision:\s*true/);
  assert.match(renderer, /type === 'prepare-terminal-capture'[\s\S]*session\.pane\.classList\.add\('active'\)/);
});
