const assert = require('node:assert/strict');
const test = require('node:test');
const { catchUpPrompt, nextCatchUp, pendingNotifications } = require('../electron/agent/catch-up.cjs');

test('catch-up processes unread notifications oldest first without mutating input', () => {
  const notifications = [
    { id: 'newer', createdAt: 30, read: false },
    { id: 'read', createdAt: 10, read: true },
    { id: 'oldest', createdAt: 20, read: false }
  ];

  assert.deepEqual(pendingNotifications(notifications).map((item) => item.id), ['oldest', 'newer']);
  assert.deepEqual(nextCatchUp(notifications), {
    notification: notifications[2],
    remainingCount: 1
  });
  assert.deepEqual(notifications.map((item) => item.id), ['newer', 'read', 'oldest']);
});

test('catch-up prompt limits the response to one generic update while more remain', () => {
  const prompt = catchUpPrompt({ id: 'one' }, 3);
  assert.match(prompt, /exactly this one pending update/);
  assert.match(prompt, /35 words/);
  assert.match(prompt, /3 other pending updates/);
  assert.match(prompt, /do not ask a next-step question/i);
});

test('final catch-up may ask what to do next', () => {
  assert.match(catchUpPrompt({ id: 'last' }, 0), /final pending update/);
  assert.equal(catchUpPrompt(null), '');
});
