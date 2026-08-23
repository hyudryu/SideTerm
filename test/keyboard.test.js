import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeTerminalShortcutEvent,
  keyboardEventToAccelerator,
  resolveTerminalShortcut
} from '../src/keyboard.js';

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

test('the voice activation chord is recognized and rebindable', () => {
  assert.equal(resolveTerminalShortcut(key('a', { shiftKey: true }), false), 'voice-activation');
  assert.equal(resolveTerminalShortcut(key('a', { shiftKey: true }), false, { voiceActivation: 'Ctrl+Shift+M' }), null);
  assert.equal(resolveTerminalShortcut(key('m', { shiftKey: true }), false, { voiceActivation: 'Ctrl+Shift+M' }), 'voice-activation');
});

test('unrelated and Alt-modified keys are left to the terminal', () => {
  assert.equal(resolveTerminalShortcut(key('l'), false), null);
  assert.equal(resolveTerminalShortcut(key('c', { altKey: true }), true), null);
});

test('custom bindings override productivity actions', () => {
  assert.equal(resolveTerminalShortcut(key('n', { shiftKey: true }), false, { newSession: 'Ctrl+Shift+N' }), 'new-session');
  assert.equal(resolveTerminalShortcut(key('t', { shiftKey: true }), false, { newSession: 'Ctrl+Shift+N' }), null);
});

test('keyboard events normalize into editable accelerator labels', () => {
  assert.equal(keyboardEventToAccelerator(key(',', { shiftKey: false })), 'Ctrl+,');
  assert.equal(keyboardEventToAccelerator(key('Tab', { shiftKey: true })), 'Ctrl+Shift+Tab');
});

test('handled shortcuts cancel browser defaults to avoid duplicate paste events', () => {
  let prevented = 0;
  let stopped = 0;
  const event = {
    preventDefault: () => prevented += 1,
    stopPropagation: () => stopped += 1
  };

  assert.equal(consumeTerminalShortcutEvent(event, 'paste'), true);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(consumeTerminalShortcutEvent(event, 'terminal-input'), false);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});
