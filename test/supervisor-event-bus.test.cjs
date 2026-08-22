const test = require('node:test');
const assert = require('node:assert/strict');
const { PriorityEventBus, normalizeSupervisorEvent, recoverAbandonedEvents } = require('../electron/supervisor/event-bus.cjs');

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

test('an acknowledged dedupe key may recur as new work', () => {
  const events = [];
  const bus = new PriorityEventBus(events);
  bus.enqueue({ id: 'first', kind: 'INFO', dedupeKey: 'github-cli-missing' });
  bus.transition('first', 'acknowledged');
  const recurrence = bus.enqueue({ id: 'second', kind: 'INFO', dedupeKey: 'github-cli-missing' });
  assert.equal(recurrence.added, true);
  assert.equal(bus.pending()[0].id, 'second');
});

test('legacy notification records migrate into typed events', () => {
  const event = normalizeSupervisorEvent({ id: 'legacy', title: 'API', summary: 'Done', read: false });
  assert.equal(event.kind, 'INFO');
  assert.equal(event.priority, 3);
  assert.equal(event.state, 'queued');
});

test('unfinished persisted presentation claims return to the queue', () => {
  const [event] = recoverAbandonedEvents([{ id: 'a', state: 'presented', read: false }]);
  assert.equal(event.state, 'queued');
});

test('interaction-bound events wait until their question is active', () => {
  const bus = new PriorityEventBus([]);
  bus.enqueue({ id: 'merge', kind: 'WATCH_CONDITION_MET', payload: { interactionId: 'merge-question' } });
  bus.enqueue({ id: 'completion', kind: 'COMPLETED' });
  assert.equal(bus.next('other-question').id, 'completion');
  assert.equal(bus.next('merge-question').id, 'merge');
});

test('catch-up selection can use the event bus priority order', () => {
  const bus = new PriorityEventBus([]);
  bus.enqueue({ id: 'new-completion', kind: 'COMPLETED', createdAt: 20 });
  bus.enqueue({ id: 'old-failure', kind: 'FAILED', createdAt: 10 });
  assert.equal(bus.next('').id, 'old-failure');
});

test('claiming hides an event from competing presenters and a failed claim can be released', () => {
  const bus = new PriorityEventBus([]);
  bus.enqueue({ id: 'completion', kind: 'COMPLETED' });
  assert.equal(bus.claimNext('').id, 'completion');
  assert.equal(bus.claimNext(''), null);
  assert.equal(bus.releaseClaim('completion').state, 'queued');
  assert.equal(bus.claimNext('').id, 'completion');
});

test('resolved interactions acknowledge every bound event', () => {
  const events = [];
  const bus = new PriorityEventBus(events);
  bus.enqueue({ id: 'merge', kind: 'WATCH_CONDITION_MET', payload: { interactionId: 'approval-1' } });
  bus.enqueue({ id: 'other', kind: 'INFO' });
  assert.equal(bus.transitionForInteraction('approval-1', 'acknowledged'), 1);
  assert.equal(events.find((event) => event.id === 'merge').read, true);
  assert.equal(events.find((event) => event.id === 'other').read, false);
});
