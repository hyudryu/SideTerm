const test = require('node:test');
const assert = require('node:assert/strict');
const { SupervisorActor } = require('../electron/supervisor/actor.cjs');

test('supervisor actor serializes tasks and prioritizes queued user work', async () => {
  const actor = new SupervisorActor();
  const order = [];
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const active = actor.enqueue(async () => { order.push('active'); await blocker; }, { priority: 2 });
  const low = actor.enqueue(async () => { order.push('low'); }, { priority: 3 });
  const user = actor.enqueue(async () => { order.push('user'); }, { priority: 0 });
  release();
  await Promise.all([active, low, user]);
  assert.deepEqual(order, ['active', 'user', 'low']);
});

test('higher-priority work cancels interruptible automatic work', async () => {
  const actor = new SupervisorActor();
  let cancelled = false;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const automatic = actor.enqueue(() => blocker, { priority: 2, interruptible: true, cancel: () => { cancelled = true; release(); } });
  const user = actor.enqueue(() => 'ok', { priority: 0 });
  assert.equal(cancelled, true);
  await Promise.all([automatic, user]);
});

test('an activation task can be cancelled by identity', async () => {
  const actor = new SupervisorActor();
  let release;
  let cancelled = false;
  const task = actor.enqueue(
    () => new Promise((resolve) => { release = resolve; }),
    { id: 'activation-1', interruptible: true, cancel: () => { cancelled = true; release('late'); } }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(actor.cancel('activation-1'), true);
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(cancelled, true);
});
