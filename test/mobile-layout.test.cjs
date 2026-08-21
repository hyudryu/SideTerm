const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileDirectory = path.join(__dirname, '..', 'electron', 'mobile');

test('mobile focusable text fields use an iOS-safe font size', () => {
  const css = fs.readFileSync(path.join(mobileDirectory, 'mobile.css'), 'utf8');
  assert.match(css, /#mobile-input[^}]*font:\s*16px/i);
  assert.match(css, /#mobile-agent-input[^}]*font:\s*16px/i);
  assert.match(css, /#mobile-settings-sheet input[^}]*font:\s*16px/i);
  assert.match(css, /\.xterm-helper-textarea[^}]*font-size:\s*16px/i);
});

test('mobile viewport keeps the device scale and allows safe-area layout', () => {
  const html = fs.readFileSync(path.join(mobileDirectory, 'index.html'), 'utf8');
  assert.match(html, /name="viewport"[^>]*width=device-width[^>]*initial-scale=1[^>]*viewport-fit=cover/i);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test('mobile voice mode is reannounced after a WebSocket reconnect', () => {
  const script = fs.readFileSync(path.join(mobileDirectory, 'mobile.js'), 'utf8');
  assert.match(script, /socket\.addEventListener\('open',[\s\S]*if \(mobileVoiceMode\) send\(\{ type: 'voice:mode', enabled: true \}\)/);
});

test('mobile creation and suppressed catch-up recover without a reload', () => {
  const script = fs.readFileSync(path.join(mobileDirectory, 'mobile.js'), 'utf8');
  assert.match(script, /resetPendingMobileCreate\('Connection was interrupted/);
  assert.match(script, /Creation timed out\. Please try again\./);
  assert.match(script, /if \(message\.hasMore\) requestNextCatchUp\(true\)/);
});

test('only final mobile speech opens the wake-word-free reply window', () => {
  const script = fs.readFileSync(path.join(mobileDirectory, 'mobile.js'), 'utf8');
  assert.match(script, /completed && openReplyWindow/);
  assert.match(script, /openReplyWindow: Boolean\(message\.opensReplyWindow\)/);
});

test('mobile loads the one-tap terminal submit helper before its app code', () => {
  const html = fs.readFileSync(path.join(mobileDirectory, 'index.html'), 'utf8');
  assert.match(html, /terminal-submit\.js[\s\S]*mobile\.js/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /route === 'terminal-submit\.js'/);
});
