const test = require('node:test');
const assert = require('node:assert/strict');
require('../electron/mobile/terminal-frame.js');
const { TerminalFrameWriter, terminalFrameText } = globalThis.SideTermTerminalFrames;

test('terminal frames normalize line endings for xterm', () => {
  assert.equal(terminalFrameText('one\ntwo\r\nthree'), 'one\r\ntwo\r\nthree');
});

test('terminal frame writer drops stale queued frames instead of interleaving them', () => {
  const writes = [];
  const callbacks = [];
  let resets = 0;
  let scrolls = 0;
  const writer = new TerminalFrameWriter({
    reset: () => { resets += 1; },
    write: (value, callback) => { writes.push(value); callbacks.push(callback); },
    scrollToBottom: () => { scrolls += 1; }
  });

  writer.select('session-1', 'Connecting\n');
  writer.render('session-1', 'old frame\n');
  writer.render('session-1', 'latest frame\n');
  assert.deepEqual(writes, ['Connecting\r\n']);

  callbacks.shift()();
  assert.deepEqual(writes, ['Connecting\r\n', 'latest frame\r\n']);
  callbacks.shift()();
  assert.equal(resets, 2);
  assert.equal(scrolls, 1);
});

test('terminal frame writer ignores another session and invalidates an old write', () => {
  const writes = [];
  const callbacks = [];
  let scrolls = 0;
  const writer = new TerminalFrameWriter({
    reset() {},
    write(value, callback) { writes.push(value); callbacks.push(callback); },
    scrollToBottom() { scrolls += 1; }
  });

  writer.select('one', 'one');
  assert.equal(writer.render('two', 'wrong'), false);
  writer.select('two', 'switching');
  writer.render('two', 'two');
  callbacks.shift()();
  assert.deepEqual(writes, ['one', 'two']);
  callbacks.shift()();
  assert.equal(scrolls, 1);
});

test('live frames preserve a reader position while selected sessions start at the bottom', () => {
  const callbacks = [];
  const restored = [];
  let scrolls = 0;
  let captures = 0;
  const writer = new TerminalFrameWriter({
    reset() {},
    write(_value, callback) { callbacks.push(callback); },
    scrollToBottom() { scrolls += 1; },
    captureViewport() { captures += 1; return { atBottom: false, distanceFromBottom: 24 }; },
    restoreViewport(viewport) { restored.push(viewport); }
  });

  writer.select('one', 'connecting');
  callbacks.shift()();
  assert.equal(scrolls, 1);
  writer.render('one', 'updated frame');
  writer.render('one', 'newer frame');
  callbacks.shift()();
  callbacks.shift()();
  assert.deepEqual(restored, [{ atBottom: false, distanceFromBottom: 24 }]);
  assert.equal(captures, 1);
  assert.equal(scrolls, 1);
});
