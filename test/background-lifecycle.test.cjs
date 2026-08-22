const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldHideWindowOnClose, shouldQuitAfterLastWindow } = require('../electron/background/lifecycle.cjs');

test('background mode hides the window without requiring login autostart', () => {
  assert.equal(shouldHideWindowOnClose({ backgroundEnabled: true, quitRequested: false }), true);
  assert.equal(shouldQuitAfterLastWindow({ platform: 'linux', backgroundEnabled: true }), false);
});

test('explicit quit always terminates background mode', () => {
  assert.equal(shouldHideWindowOnClose({ backgroundEnabled: true, quitRequested: true }), false);
  assert.equal(shouldQuitAfterLastWindow({ platform: 'linux', backgroundEnabled: true, quitRequested: true }), true);
});

test('disabling background mode preserves normal platform lifecycle', () => {
  assert.equal(shouldHideWindowOnClose({ backgroundEnabled: false }), false);
  assert.equal(shouldQuitAfterLastWindow({ platform: 'linux', backgroundEnabled: false }), true);
  assert.equal(shouldQuitAfterLastWindow({ platform: 'darwin', backgroundEnabled: false }), false);
});
