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
  assert.match(main, /const deltas = sessionSupportsMobileDeltas\(session\);[\s\S]{0,80}if \(!deltas\) scheduleMobileTerminalFrame\(id\);/);
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

test('tmux snapshots honor drawer visibility and keep activity for other viewers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /client\.sideTermSessionId === id\r?\n?\s*&& client\.sideTermTerminalVisible !== false/);
  assert.match(main, /if \(client\.sideTermTerminalVisible === false\) return;/);
  assert.match(main, /if \(!deltas\) scheduleMobileTerminalFrame\(id\);/);
  assert.match(main, /if \(!deltas \|\| client\.sideTermTerminalVisible === false\) continue;/);
  assert.match(main, /mobileFrameDeliveryState\(client\) === 'backlog'/);
  assert.match(main, /if \(client\.sideTermResyncTimer\) clearTimeout\(client\.sideTermResyncTimer\);/);
});

test('server resync waits for WebSocket backpressure to drain', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const state = mobileResyncState\(client\);[\s\S]*state === 'wait'[\s\S]*scheduleMobileResync\(client\);/);
  assert.match(main, /mobileFrameDeliveryState\(client\) === 'backlog'[\s\S]*scheduleMobileResync\(client\);[\s\S]*continue;/);
  assert.match(main, /function scheduleMobileTerminalFrame[\s\S]*mobileFrameDeliveryState\(client\)[\s\S]*state === 'backlog'[\s\S]*scheduleMobileResync\(client\)/);
});

test('exited mobile sessions retain a selectable final frame', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const mobileExitedSessions = new Map\(\);/);
  assert.match(main, /retainMobileExitedSession\(id, session, finalScreen, exitCode\);[\s\S]*sessions\.delete\(id\);[\s\S]*broadcastMobileSnapshot\(\);/);
  assert.match(main, /message\.type === 'select' && \(session \|\| mobileExitedSessions\.has/);
});
