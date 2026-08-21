const test = require('node:test');
const assert = require('node:assert/strict');
require('../electron/mobile/terminal-submit.js');
const { submitTerminalInput } = globalThis.SideTermMobileSubmit;

test('one mobile submit sends text and Enter as separate ordered writes', () => {
  const writes = [];
  const timers = [];
  const sent = submitTerminalInput({
    value: 'Fix the tests',
    send(data) { writes.push(data); return true; },
    setTimer(callback, delay) { timers.push({ callback, delay }); }
  });

  assert.equal(sent, true);
  assert.deepEqual(writes, ['Fix the tests']);
  assert.equal(timers[0].delay, 75);
  timers[0].callback();
  assert.deepEqual(writes, ['Fix the tests', '\r']);
});

test('an empty mobile submit sends a single Enter immediately', () => {
  const writes = [];
  assert.equal(submitTerminalInput({ value: '', send(data) { writes.push(data); return true; } }), true);
  assert.deepEqual(writes, ['\r']);
});

test('failed text sends do not schedule Enter or clear the input', () => {
  let scheduled = false;
  assert.equal(submitTerminalInput({
    value: 'keep me',
    send() { return false; },
    setTimer() { scheduled = true; }
  }), false);
  assert.equal(scheduled, false);
});
