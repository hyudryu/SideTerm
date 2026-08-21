const test = require('node:test');
const assert = require('node:assert/strict');
const { canSubmitTuiKey, namedKeyData, selectionKeys, tuiSnapshot } = require('../electron/sessions/tui.cjs');

test('semantic TUI snapshot finds selected options and minimal navigation', () => {
  const snapshot = tuiSnapshot('  First option\n> Second option\n  Third option'.replace(/^  /gm, '  1. '), 'terminal');
  const direct = tuiSnapshot('  1. First option\n> Second option\n  3. Third option', 'terminal');
  assert.equal(direct.selectedIndex, 1);
  assert.deepEqual(selectionKeys(direct, 2), ['DOWN', 'ENTER']);
  assert.equal(snapshot.terminalId, 'terminal');
});

test('named keys hide terminal escape sequences from callers', () => {
  assert.equal(namedKeyData('ENTER'), '\r');
  assert.throws(() => namedKeyData('rm -rf'));
});

test('submission keys require an explicitly selected TUI option', () => {
  const numbered = tuiSnapshot('1. First option\n2. Second option', 'terminal');
  const selected = tuiSnapshot('1. First option\n> Second option', 'terminal');
  const bullet = tuiSnapshot('* Not a selected control\n* Another bullet', 'terminal');
  assert.equal(numbered.selectedIndex, -1);
  assert.equal(canSubmitTuiKey(numbered, 'ENTER'), false);
  assert.equal(canSubmitTuiKey(bullet, 'SPACE'), false);
  assert.equal(canSubmitTuiKey(selected, 'ENTER'), true);
  assert.equal(canSubmitTuiKey(numbered, 'UP'), true);
});
