const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('visual inspection captures the styled live terminal and preserves fallback routing', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /requestRendererAction\('prepare-terminal-capture'/);
  assert.match(main, /try \{[\s\S]*requestRendererAction\('prepare-terminal-capture'[\s\S]*finally \{[\s\S]*requestRendererAction\('restore-terminal-capture'/);
  assert.match(main, /webContents\.capturePage\(bounds\)/);
  assert.doesNotMatch(main, /forceVision:\s*true/);
  assert.match(renderer, /type === 'prepare-terminal-capture'[\s\S]*session\.pane\.classList\.add\('active'\)/);
  assert.match(renderer, /session\.fit\.fit\(\);[\s\S]*await waitForTerminalCaptureRepaint\(\)/);
  assert.match(renderer, /window\.setTimeout\(done, 80\)/);
});

test('terminal capture hides credential-bearing and nonterminal overlays', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /querySelectorAll\('\.settings-backdrop, \.link-popover, \.toast-region'\)/);
  assert.match(renderer, /for \(const overlay of overlayStates\) overlay\.element\.hidden = true/);
  assert.match(renderer, /for \(const overlay of overlayStates\) overlay\.element\.hidden = overlay\.hidden/);
  assert.match(renderer, /supervisorDashboard\.hidden = true/);
});
