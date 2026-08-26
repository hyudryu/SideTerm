const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileAgentState } = require('../electron/mobile/agent-state.cjs');

test('mobile agent state omits large desktop-only review and notification payloads', () => {
  const projected = mobileAgentState({
    enabled: true,
    status: 'thinking',
    messages: Array.from({ length: 50 }, (_, index) => ({ role: 'assistant', text: `message ${index}` })),
    notifications: Array.from({ length: 12 }, (_, index) => ({
      id: `notification-${index}`,
      read: index < 3,
      title: `Update ${index}`,
      summary: 'Done',
      context: 'x'.repeat(100_000),
      payload: { raw: 'y'.repeat(100_000) }
    })),
    confirmations: [{ id: 'confirm', kind: 'merge-pull-request', title: 'PR', pullRequestUrl: 'https://github.com/a/b/pull/1' }],
    pullRequests: [{ comments: [{ body: 'z'.repeat(1_000_000) }] }],
    watches: [{ state: 'active' }],
    archivedSessions: [{ context: 'z'.repeat(1_000_000) }]
  });

  assert.equal(projected.messages.length, 40);
  assert.equal(projected.notifications.length, 8);
  assert.equal(projected.unreadNotificationCount, 9);
  assert.equal(projected.confirmations[0].id, 'confirm');
  assert.equal(Object.hasOwn(projected, 'pullRequests'), false);
  assert.equal(Object.hasOwn(projected.notifications[0], 'context'), false);
  assert.ok(JSON.stringify(projected).length < 20_000);
});
