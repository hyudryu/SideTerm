const assert = require('node:assert/strict');
const test = require('node:test');
const { ProactiveCatchUpScheduler } = require('../electron/agent/proactive.cjs');

function fakeClock() {
  let current = 1_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => current,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, at: current + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || due[1].at > target) return;
        timers.delete(due[0]);
        current = due[1].at;
        await due[1].callback();
      }
    },
    pendingCount: () => timers.size
  };
}

function scheduler(run, clock, options = {}) {
  return new ProactiveCatchUpScheduler({
    run,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayMs: 100,
    retryDelayMs: 50,
    minIntervalMs: 200,
    maxAttempts: 2,
    ...options
  });
}

test('newly finished work triggers one background run after the batch delay', async () => {
  const clock = fakeClock();
  const runs = [];
  const plan = scheduler(async () => {
    runs.push(clock.now());
    return 'ran';
  }, clock);
  plan.notify();
  plan.notify();
  plan.notify();
  assert.equal(clock.pendingCount(), 1);
  await clock.advance(100);
  assert.deepEqual(runs, [1_100]);
});

test('a busy supervisor retries instead of dropping the check-in', async () => {
  const clock = fakeClock();
  const outcomes = ['busy', 'ran'];
  const runs = [];
  const plan = scheduler(async () => {
    runs.push(outcomes.shift());
    return runs.at(-1);
  }, clock);
  plan.notify();
  await clock.advance(100);
  await clock.advance(50);
  assert.deepEqual(runs, ['busy', 'ran']);
});

test('failed runs stop after the attempt budget so a dead provider cannot loop', async () => {
  const clock = fakeClock();
  const runs = [];
  const plan = scheduler(async () => {
    runs.push('failed');
    return 'failed';
  }, clock);
  plan.notify();
  await clock.advance(400);
  assert.equal(runs.length, 2);
  assert.equal(clock.pendingCount(), 0);
});

test('skipped runs are not retried', async () => {
  const clock = fakeClock();
  const runs = [];
  const plan = scheduler(async () => {
    runs.push('skipped');
    return 'skipped';
  }, clock);
  plan.notify();
  await clock.advance(400);
  assert.equal(runs.length, 1);
  assert.equal(clock.pendingCount(), 0);
});

test('back-to-back check-ins respect the minimum spacing', async () => {
  const clock = fakeClock();
  const runs = [];
  const plan = scheduler(async () => {
    runs.push(clock.now());
    return 'ran';
  }, clock);
  plan.notify();
  await clock.advance(100);
  plan.notify();
  await clock.advance(100);
  assert.deepEqual(runs, [1_100]);
  await clock.advance(100);
  assert.deepEqual(runs, [1_100, 1_300]);
});

test('cancel drops a scheduled check-in', async () => {
  const clock = fakeClock();
  const runs = [];
  const plan = scheduler(async () => {
    runs.push('ran');
    return 'ran';
  }, clock);
  plan.notify();
  plan.cancel();
  await clock.advance(400);
  assert.deepEqual(runs, []);
});
