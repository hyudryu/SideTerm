const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventLoopLagMonitor, createLogger } = require('../electron/logging.cjs');

function tempLogPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-log-')), 'sideterm-main.log');
}

test('logger writes timestamped levelled lines to the file', () => {
  const filePath = tempLogPath();
  const log = createLogger({ filePath });
  log.info('ready');
  log.warn('blocked', { lagMs: 812 });
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T.* \[INFO\] ready$/);
  assert.match(lines[1], /\[WARN\] blocked \{"lagMs":812\}$/);
});

test('logger formats Error details with the stack', () => {
  const filePath = tempLogPath();
  const log = createLogger({ filePath });
  log.error('boom', new Error('kaput'));
  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(content, /\[ERROR\] boom Error: kaput/);
});

test('logger rotates the previous log once over the size cap', () => {
  const filePath = tempLogPath();
  const log = createLogger({ filePath, maxBytes: 200 });
  log.info('x'.repeat(150));
  log.info('y'.repeat(150));
  const rotated = fs.readFileSync(`${filePath}.1`, 'utf8');
  assert.match(rotated, /x{150}/);
  assert.match(fs.readFileSync(filePath, 'utf8'), /y{150}/);
});

test('lag monitor reports timer overshoot beyond the threshold', () => {
  let now = 10_000;
  let tick;
  const lags = [];
  const monitor = createEventLoopLagMonitor({
    intervalMs: 1000,
    warnThresholdMs: 100,
    onLag: (lagMs) => lags.push(lagMs),
    setTimer: (fn) => { tick = fn; return { unref() {} }; },
    clearTimer: () => {},
    now: () => now
  });
  monitor.start();
  now += 1000; // on time: no report
  tick();
  now += 1450; // 450ms late: report 450
  tick();
  now += 1030; // 30ms late: below threshold
  tick();
  assert.deepEqual(lags, [450]);
});

test('lag monitor start is idempotent and stop clears the timer', () => {
  let cleared = 0;
  const timers = new Set();
  const monitor = createEventLoopLagMonitor({
    onLag: () => {},
    setTimer: () => { const t = { unref() {} }; timers.add(t); return t; },
    clearTimer: () => { cleared += 1; }
  });
  monitor.start();
  monitor.start();
  assert.equal(timers.size, 1);
  assert.equal(monitor.isRunning(), true);
  monitor.stop();
  monitor.stop();
  assert.equal(cleared, 1);
  assert.equal(monitor.isRunning(), false);
});
