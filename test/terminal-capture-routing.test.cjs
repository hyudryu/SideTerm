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

test('whole-window capture uses the same overlay hide and restore lifecycle', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /requestRendererAction\('prepare-window-capture'/);
  assert.match(main, /prepare-window-capture'[\s\S]*capturePage\(\)[\s\S]*finally \{[\s\S]*restore-terminal-capture/);
  assert.match(renderer, /type === 'prepare-window-capture'[\s\S]*hideNonterminalCaptureOverlays\(\{ hideDashboard: false \}\)/);
});

test('session capture restores the live active session without dropping PTY output', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /sessions\.get\(activeId\)\?\.pane\.classList\.add\('active'\)/);
  assert.doesNotMatch(renderer, /for \(const pane of activePanes\) pane\.classList\.add\('active'\)/);
  assert.doesNotMatch(renderer, /captureRedrawSuppressedUntil/);
  assert.match(renderer, /api\.onData[\s\S]*recordSessionResponse\(session, data\);[\s\S]*appendSessionContext\(session, data\);[\s\S]*noteBackgroundActivity\(session, data\)/);
});

test('whole-window capture preserves the dashboard while masking sensitive overlays', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /hideNonterminalCaptureOverlays\(\{ hideDashboard = true \} = \{\}\)/);
  assert.match(renderer, /if \(hideDashboard\) \{[\s\S]*supervisorDashboard\.hidden = true/);
});

test('collection status inspection includes the bounded live session list', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const listedSessions = sessionId \? \[\] : workspaceSessions\.slice\(0, 200\)\.map/);
  assert.match(main, /status: item\.busy \? 'running' : sessions\.has\(item\.id\) \? 'idle' : 'stopped'/);
  assert.match(main, /needsAttention: Boolean\(item\.notified\)/);
  assert.match(main, /fitSessionCollection\(\{[\s\S]*sessionCollection: \{[\s\S]*\.\.\.sessionCounts/);
  assert.match(main, /session: structuredSessionRecord\(\{[\s\S]*metadata,[\s\S]*live: Boolean\(session\)/);
});

test('persisted vision upload consent fails closed unless it is boolean true', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /visionEnabled: parsed\.visionEnabled === true/);
  assert.doesNotMatch(main, /visionEnabled: Boolean\(parsed\.visionEnabled\)/);
});
