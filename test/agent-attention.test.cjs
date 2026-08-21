const assert = require('node:assert/strict');
const test = require('node:test');
const { acknowledgeAttentionNotification, attentionCycleId, reconcileAttentionNotifications } = require('../electron/agent/attention.cjs');

test('restored attention sessions become unread supervisor notifications', () => {
  const state = { notifications: [] };
  const workspace = {
    sessions: [{
      id: 'session-1', title: 'Codex', summary: 'Tests finished', cwd: '/repo',
      notified: true, attentionCycleId: 'cycle-1', links: ['https://github.com/a/b/pull/1']
    }]
  };
  const added = reconcileAttentionNotifications(state, workspace, {
    now: () => 123,
    createId: () => 'notification-1',
    contextForSession: () => 'All checks passed.'
  });

  assert.equal(added.length, 1);
  assert.deepEqual(state.notifications[0], {
    id: 'notification-1', cycleId: 'cycle-1', sessionId: 'session-1', title: 'Codex',
    kind: 'COMPLETED', priority: 2,
    summary: 'Tests finished', context: 'All checks passed.', cwd: '/repo',
    links: ['https://github.com/a/b/pull/1'], createdAt: 123, read: false
  });
});

test('restored urgent session outcomes retain live-event priority', () => {
  const state = { notifications: [] };
  reconcileAttentionNotifications(state, {
    sessions: [{ id: 'blocked', notified: true, summary: 'Blocked and waiting for your input.' }]
  }, { createId: () => 'urgent' });
  assert.equal(state.notifications[0].kind, 'INPUT_REQUIRED');
  assert.equal(state.notifications[0].priority, 0);
});

test('attention reconciliation is idempotent across workspace updates and restarts', () => {
  const workspace = { sessions: [{ id: 'session-1', notified: true }] };
  const state = { notifications: [] };
  const options = { createId: () => 'notification-1' };

  reconcileAttentionNotifications(state, workspace, options);
  reconcileAttentionNotifications(state, workspace, options);

  assert.equal(attentionCycleId(workspace.sessions[0]), 'restored:session-1');
  assert.equal(state.notifications.length, 1);
});

test('idle acknowledged sessions are not added to the supervisor inbox', () => {
  const state = { notifications: [] };
  const added = reconcileAttentionNotifications(state, {
    sessions: [{ id: 'session-1', notified: false, attentionCycleId: 'cycle-1' }]
  });
  assert.deepEqual(added, []);
  assert.deepEqual(state.notifications, []);
});

test('opening a session acknowledges only its matching attention cycle', () => {
  const state = {
    notifications: [
      { sessionId: 'session-1', cycleId: 'cycle-1', read: false },
      { sessionId: 'session-1', cycleId: 'cycle-2', read: false },
      { sessionId: 'session-2', cycleId: 'cycle-1', read: false }
    ]
  };

  assert.equal(acknowledgeAttentionNotification(state, 'session-1', 'cycle-1'), 1);
  assert.deepEqual(state.notifications.map((item) => item.read), [true, false, false]);
});
