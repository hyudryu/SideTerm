const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { automaticPresenterSentinel, catchUpPrompt, isAutomaticPresenterSentinel, isNoUpdateResponse, markSupersededNotificationsRead, nextCatchUp, pendingNotifications, shouldScheduleWorkspaceCatchUp } = require('../electron/agent/catch-up.cjs');

test('catch-up processes newest unread notifications first without mutating input', () => {
  const notifications = [
    { id: 'newer', createdAt: 30, read: false },
    { id: 'read', createdAt: 10, read: true },
    { id: 'oldest', createdAt: 20, read: false }
  ];

  assert.deepEqual(pendingNotifications(notifications).map((item) => item.id), ['newer', 'oldest']);
  assert.deepEqual(nextCatchUp(notifications), {
    notification: notifications[0],
    remainingCount: 1
  });
  assert.deepEqual(notifications.map((item) => item.id), ['newer', 'read', 'oldest']);
});

test('catch-up keeps only the newest unread correspondence for each terminal', () => {
  const notifications = [
    { id: 'old-session-one', sessionId: 'one', createdAt: 10, read: false },
    { id: 'new-session-two', sessionId: 'two', createdAt: 40, read: false },
    { id: 'new-session-one', sessionId: 'one', createdAt: 30, read: false }
  ];
  assert.deepEqual(pendingNotifications(notifications).map((item) => item.id), ['new-session-two', 'new-session-one']);
  markSupersededNotificationsRead(notifications);
  assert.deepEqual(notifications.map((item) => item.read), [true, false, false]);
});

test('catch-up preserves semantically distinct typed events from one session', () => {
  const notifications = [
    { id: 'failure', sessionId: 'one', kind: 'FAILED', createdAt: 10, read: false },
    { id: 'review', sessionId: 'one', kind: 'REVIEW_RECEIVED', createdAt: 20, read: false },
    { id: 'new-failure', sessionId: 'one', kind: 'FAILED', createdAt: 30, read: false }
  ];
  markSupersededNotificationsRead(notifications);
  assert.deepEqual(pendingNotifications(notifications).map((item) => item.id), ['new-failure', 'review']);
  assert.deepEqual(notifications.map((item) => item.read), [true, false, false]);
});

test('catch-up prompt limits the response to one generic update while more remain', () => {
  const prompt = catchUpPrompt({ id: 'one' }, 3);
  assert.match(prompt, /exactly this one pending update/);
  assert.match(prompt, /35 words/);
  assert.match(prompt, /3 other pending updates/);
  assert.match(prompt, /do not ask a next-step question/i);
  assert.match(prompt, /exactly NO_UPDATE/);
});

test('automatic no-update responses are recognized without leaking into chat', () => {
  assert.equal(isNoUpdateResponse('NO_UPDATE'), true);
  assert.equal(isNoUpdateResponse('no_update.'), true);
  assert.equal(isNoUpdateResponse('No update is available.'), false);
});

test('automatic presenter sentinels are never spoken as updates', () => {
  assert.equal(isAutomaticPresenterSentinel('NO_UPDATE.'), true);
  assert.equal(isAutomaticPresenterSentinel('NEEDS_ENRICHMENT!'), true);
  assert.equal(isAutomaticPresenterSentinel('The tests passed.'), false);
  assert.equal(automaticPresenterSentinel('NEEDS_ENRICHMENT.'), 'NEEDS_ENRICHMENT');
});

test('final catch-up may ask what to do next', () => {
  assert.match(catchUpPrompt({ id: 'last' }, 0), /final pending update/);
  assert.equal(catchUpPrompt(null), '');
});

test('proactive enrichment yields to higher-priority user work', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /if \(result\.needsEnrichment\) \{[\s\S]*?notificationIds: \[event\.id\],[\s\S]*?interruptible: true/);
});

test('dashboard and proactive catch-up share the same persisted event claim', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function claimNextSupervisorEvent\(\)[\s\S]*claimNext\(state\.activeInteractionId\)[\s\S]*writeAgentState\(state\)/);
  assert.match(main, /async function runProactiveCatchUp\([^)]*\)[\s\S]*const \{ state, event \} = claimNextSupervisorEvent\(\)/);
  assert.match(main, /async function catchUpWithSupervisor[\s\S]*const \{ state, event: notification \} = claimNextSupervisorEvent\(\)/);
  assert.match(main, /releaseSupervisorEventClaim\(notification\.id\)/);
});

test('abandoned presentation claims recover once at application startup', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const readAgentState = main.match(/function readAgentState\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(readAgentState, /recoverAbandonedEvents/);
  assert.match(main, /function recoverAbandonedAgentStateEvents\(\)[\s\S]*recoverAbandonedEvents\(state\.notifications\)[\s\S]*writeAgentState\(state\)/);
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{\s*recoverAbandonedAgentStateEvents\(\);/);
});

test('persisted unread updates are scheduled once after workspace restoration', () => {
  assert.equal(shouldScheduleWorkspaceCatchUp({ unreadCount: 1, initialized: false }), true);
  assert.equal(shouldScheduleWorkspaceCatchUp({ unreadCount: 1, initialized: true }), false);
  assert.equal(shouldScheduleWorkspaceCatchUp({ addedCount: 1, unreadCount: 1, initialized: true }), true);
});
