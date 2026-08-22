const test = require('node:test');
const assert = require('node:assert/strict');
const { canSubmitTuiKey, namedKeyData, selectionKeys, tuiSelectionAccepted, tuiSnapshot } = require('../electron/sessions/tui.cjs');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.equal(canSubmitTuiKey(numbered, 'UP'), false);
  assert.equal(canSubmitTuiKey(selected, 'UP'), true);
});

test('checked controls are not mistaken for keyboard focus', () => {
  const snapshot = tuiSnapshot('[x] Run tests\n[ ] Commit', 'terminal');
  assert.equal(snapshot.options[0].checked, true);
  assert.equal(snapshot.selectedIndex, -1);
  assert.equal(canSubmitTuiKey(snapshot, 'ENTER'), false);
});

test('cursor navigation alone does not prove Enter submitted a selection', () => {
  const navigated = tuiSnapshot('  1. First option\n> Second option', 'terminal');
  assert.equal(tuiSelectionAccepted(navigated, navigated), false);
  assert.equal(tuiSelectionAccepted(navigated, tuiSnapshot('Starting tests…', 'terminal')), true);
});

test('main-process TUI submission gates Space and revalidates the authorized label', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function captureSessionViewport\(session\)[\s\S]*\['capture-pane', '-p', '-t', session\.tmuxSession\]/);
  assert.doesNotMatch(main, /tuiSnapshot\(captureSessionScreen/);
  assert.match(main, /tuiSnapshot\(captureSessionViewport/);
  assert.match(main, /\['ENTER', 'SPACE'\]\.includes\(normalized\)/);
  assert.match(main, /beforeSubmit\.options\[targetIndex\]\?\.label !== expectedLabel/);
  assert.match(main, /kind: 'tui-selection', sessionId, optionIndex, optionLabel, tuiKey: normalized/);
});
