const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createWindowsVtOutputNormalizer,
  repairWindowsVtOutput,
  shouldRepairWindowsVtOutput
} = require('../electron/sessions/windows-vt-output.cjs');

const ESC = '\u001b';
const ARROW = '\u2190';

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimer(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    runAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    }
  };
}

test('Kimi CP437 escape sequences are restored before terminal rendering', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  const broken = `${ARROW}[?2026h ${ARROW}[0m${ARROW}]8;;\u0007${ARROW}[?2026l${ARROW}[2K Welcome to Kimi Code`;
  const expected = `${ESC}[?2026h ${ESC}[0m${ESC}]8;;\u0007${ESC}[?2026l${ESC}[2K Welcome to Kimi Code`;

  assert.equal(shouldRepairWindowsVtOutput(broken), true);
  assert.equal(normalizer.push(broken), expected);
  assert.equal(normalizer.repairing, true);
});

test('the whole Kimi sentinel is buffered across every PTY chunk boundary', () => {
  const sentinel = `${ARROW}[?2026h`;
  for (let split = 1; split < sentinel.length; split += 1) {
    const timers = fakeTimers();
    const delayed = [];
    const normalizer = createWindowsVtOutputNormalizer({
      enabled: true,
      onOutput: (value) => delayed.push(value),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    assert.equal(normalizer.push(`prefix${sentinel.slice(0, split)}`), 'prefix');
    assert.equal(normalizer.push(`${sentinel.slice(split)} ${ARROW}[0m`), `${ESC}[?2026h ${ESC}[0m`);
    timers.runAll();
    assert.deepEqual(delayed, []);
  }
});

test('ordinary arrow-index output never activates repair', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  const prose = `${ARROW}[0], ${ARROW}[1], ${ARROW}[2], Move ${ARROW}[left], and print ${ARROW}[0m.`;

  assert.equal(normalizer.push(prose), prose);
  assert.equal(normalizer.repairing, false);
});

test('an incomplete sentinel candidate is released while the process remains alive', () => {
  const timers = fakeTimers();
  const delayed = [];
  const normalizer = createWindowsVtOutputNormalizer({
    enabled: true,
    onOutput: (value) => delayed.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.equal(normalizer.push(`prompt ${ARROW}`), 'prompt ');
  timers.runAll();
  assert.deepEqual(delayed, [ARROW]);
  assert.equal(normalizer.flush(), '');
});

test('a nonmatching chunk releases a pending arrow once and cancels its timer', () => {
  const timers = fakeTimers();
  const delayed = [];
  const normalizer = createWindowsVtOutputNormalizer({
    enabled: true,
    onOutput: (value) => delayed.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.equal(normalizer.push(ARROW), '');
  assert.equal(normalizer.push('x'), `${ARROW}x`);
  timers.runAll();
  assert.deepEqual(delayed, []);
});

test('active repair handles split CSI and two-character VT escapes', () => {
  const timers = fakeTimers();
  const delayed = [];
  const normalizer = createWindowsVtOutputNormalizer({
    enabled: true,
    onOutput: (value) => delayed.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  normalizer.push(`${ARROW}[?2026h`);

  assert.equal(normalizer.push(`before${ARROW}`), 'before');
  assert.equal(normalizer.push(`[31mred${ARROW}7saved${ARROW}8restored`), `${ESC}[31mred${ESC}7saved${ESC}8restored`);
  timers.runAll();
  assert.deepEqual(delayed, []);
});

test('active repair preserves real escapes and repairs OSC string terminators', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  normalizer.push(`${ARROW}[?2026h`);

  assert.equal(
    normalizer.push(`${ESC}[31mred${ESC}[0m ${ARROW}]8;;https://example.com${ARROW}\\link${ARROW}]8;;${ARROW}\\`),
    `${ESC}[31mred${ESC}[0m ${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\`
  );
});

test('repair recognizes common single-character and character-set VT escapes', () => {
  const broken = `${ARROW}7${ARROW}8${ARROW}D${ARROW}M${ARROW}(${ARROW})`;
  assert.equal(repairWindowsVtOutput(broken), `${ESC}7${ESC}8${ESC}D${ESC}M${ESC}(${ESC})`);
});

test('flush preserves a pending sentinel prefix', () => {
  const timers = fakeTimers();
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  assert.equal(normalizer.push(`wait${ARROW}[?`), 'wait');
  assert.equal(normalizer.flush(), `${ARROW}[?`);
  timers.runAll();
});

test('dispose cancels delayed output and drops pending data', () => {
  const timers = fakeTimers();
  const delayed = [];
  const normalizer = createWindowsVtOutputNormalizer({
    enabled: true,
    onOutput: (value) => delayed.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.equal(normalizer.push(ARROW), '');
  normalizer.dispose();
  timers.runAll();
  assert.deepEqual(delayed, []);
  assert.equal(normalizer.flush(), '');
});

test('disabled normalizer is a byte-for-byte pass-through', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: false });
  const broken = `${ARROW}[?2026h${ARROW}[0m${ARROW}[2K${ARROW}`;

  assert.equal(normalizer.push(broken), broken);
  assert.equal(normalizer.flush(), '');
  assert.equal(normalizer.repairing, false);
});
