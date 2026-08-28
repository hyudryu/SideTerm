const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mobile activity updates one unread indicator without rebuilding the session list', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(mobile, /function markSessionUnread\(id\)[\s\S]*unread\.has\(id\)[\s\S]*classList\.add\('unread'\)/);
  assert.match(mobile, /message\.type === 'terminal:activity'[\s\S]*!unread\.has\(message\.id\)[\s\S]*markSessionUnread\(message\.id\)/);
});

test('mobile terminal pauses behind the drawer and streams incremental output when visible', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(mobile, /function setDrawer\(open,[\s\S]*type: 'terminal:visibility'[\s\S]*visible: !open/);
  assert.match(mobile, /message\.type === 'terminal:data'[\s\S]*terminalFrames\.append\(message\.id, message\.data\)/);
  assert.match(main, /client\.sideTermTerminalVisible !== false[\s\S]*type: 'terminal:data'/);
});

test('raw-buffer sessions stream deltas while tmux sessions keep authoritative snapshots', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function sessionSupportsMobileDeltas\(session\)/);
  assert.match(main, /!sessionSupportsMobileDeltas\(session\)[\s\S]{0,200}scheduleMobileTerminalFrame\(id\)/);
  assert.match(main, /clearMobileTerminalFrame\(id\);/);
  assert.match(main, /for \(const timer of mobileTerminalFrameTimers\.values\(\)\) clearTimeout\(timer\);/);
});

test('switching sessions never captures the session being left', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(main, /const refreshId = String\(message\.requestId \|\| ''\)\.slice\(0, 100\);[\s\S]*?client\.sideTermSessionId && refreshId/);
  assert.match(mobile, /setDrawer\(false, \{ refresh: false \}\);[\s\S]*?send\(\{ type: 'select', id, requestId \}\);/);
});

test('incremental overflow falls back to an authoritative frame instead of growing forever', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(mobile, /onOverflow: \(sessionId\) => \{[\s\S]*?send\(\{ type: 'select', id: sessionId, requestId:/);
});

test('mobile refuses to approve confirmations it cannot fully display', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(mobile, /if \(confirmation\.truncated\) \{[\s\S]*?approve\.disabled = true;[\s\S]*?\}/);
});
