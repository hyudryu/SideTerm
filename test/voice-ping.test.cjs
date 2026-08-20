const assert = require('node:assert/strict');
const test = require('node:test');
const { VoicePingScheduler } = require('../electron/agent/voice-ping.cjs');

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

function ping(plan, clock, { unread = () => true } = {}) {
  return new VoicePingScheduler({
    speak: (text) => plan.push([clock.now(), text]),
    hasUnread: unread,
    backoffMs: [300, 600, 900],
    phrases: ['Hey, you there?', 'Hey, got a minute?', 'You around?', 'Hey, still there?'],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
}

test('a pending update speaks one presence check immediately', () => {
  const clock = fakeClock();
  const spoken = [];
  ping(spoken, clock).start();
  assert.deepEqual(spoken, [[1_000, 'Hey, you there?']]);
  assert.equal(clock.pendingCount(), 1);
});

test('unanswered pings re-ask after five, ten, then fifteen minutes and stop', async () => {
  const clock = fakeClock();
  const spoken = [];
  ping(spoken, clock).start();
  await clock.advance(300);
  assert.deepEqual(spoken.map(([, text]) => text), ['Hey, you there?', 'Hey, got a minute?']);
  await clock.advance(600);
  assert.deepEqual(spoken.map(([, text]) => text), ['Hey, you there?', 'Hey, got a minute?', 'You around?']);
  await clock.advance(900);
  assert.deepEqual(spoken.map(([, text]) => text), ['Hey, you there?', 'Hey, got a minute?', 'You around?', 'Hey, still there?']);
  await clock.advance(3_600);
  assert.equal(spoken.length, 4);
  assert.equal(clock.pendingCount(), 0);
});

test('a user response cancels the re-ask cycle', async () => {
  const clock = fakeClock();
  const spoken = [];
  const plan = ping(spoken, clock);
  plan.start();
  plan.reset();
  await clock.advance(3_600);
  assert.equal(spoken.length, 1);
});

test('pings stop once the pending update has been delivered', async () => {
  const clock = fakeClock();
  const spoken = [];
  let unread = true;
  const plan = ping(spoken, clock, { unread: () => unread });
  plan.start();
  unread = false;
  await clock.advance(300);
  assert.equal(spoken.length, 1);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(plan.active, false);
});
