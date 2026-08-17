import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTerminalShortcut } from '../src/keyboard.js';

function key(key, overrides = {}) {
  return { key, ctrlKey: true, shiftKey: false, altKey: false, ...overrides };
}

test('Ctrl+C copies when terminal text is selected', () => {
  assert.equal(resolveTerminalShortcut(key('c'), true), 'copy');
});

test('Ctrl+C reaches the shell when no text is selected', () => {
  assert.equal(resolveTerminalShortcut(key('c'), false), 'terminal-input');
});

test('Ctrl+V and Ctrl+Shift+V paste', () => {
  assert.equal(resolveTerminalShortcut(key('v'), false), 'paste');
  assert.equal(resolveTerminalShortcut(key('V', { shiftKey: true }), false), 'paste');
});

test('session and sidebar shortcuts are recognized', () => {
  assert.equal(resolveTerminalShortcut(key('t', { shiftKey: true }), false), 'new-session');
  assert.equal(resolveTerminalShortcut(key('w', { shiftKey: true }), false), 'close-session');
  assert.equal(resolveTerminalShortcut(key('b', { shiftKey: true }), false), 'toggle-sidebar');
  assert.equal(resolveTerminalShortcut(key('Tab'), false), 'next-session');
  assert.equal(resolveTerminalShortcut(key('Tab', { shiftKey: true }), false), 'previous-session');
});

test('unrelated and Alt-modified keys are left to the terminal', () => {
  assert.equal(resolveTerminalShortcut(key('l'), false), null);
  assert.equal(resolveTerminalShortcut(key('c', { altKey: true }), true), null);
});
