const test = require('node:test');
const assert = require('node:assert/strict');
const { PriorityEventBus, normalizeSupervisorEvent } = require('../electron/supervisor/event-bus.cjs');

test('priority event bus presents urgent work before completions', () => {
  const events = [];
  const bus = new PriorityEventBus(events, { createId: (() => { let id = 0; return () => `event-${++id}`; })(), now: () => 10 });
  bus.enqueue({ kind: 'COMPLETED', sessionId: 'a', dedupeKey: 'a:1' });
  bus.enqueue({ kind: 'INPUT_REQUIRED', sessionId: 'b', dedupeKey: 'b:1' });
  assert.equal(bus.next().sessionId, 'b');
});

test('priority event bus deduplicates exact events and supersedes stale same-session events', () => {
  const events = [];
  const bus = new PriorityEventBus(events);
  const first = bus.enqueue({ id: 'one', kind: 'COMPLETED', sessionId: 'a', dedupeKey: 'a:one' });
  assert.equal(bus.enqueue({ id: 'duplicate', kind: 'COMPLETED', sessionId: 'a', dedupeKey: 'a:one' }).added, false);
  bus.enqueue({ id: 'two', kind: 'COMPLETED', sessionId: 'a', dedupeKey: 'a:two' });
  assert.equal(first.event.state, 'superseded');
  assert.equal(bus.pending().length, 1);
  assert.equal(bus.pending()[0].id, 'two');
});

test('legacy notification records migrate into typed events', () => {
  const event = normalizeSupervisorEvent({ id: 'legacy', title: 'API', summary: 'Done', read: false });
  assert.equal(event.kind, 'INFO');
  assert.equal(event.priority, 3);
  assert.equal(event.state, 'queued');
});
