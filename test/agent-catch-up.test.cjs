const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { automaticPresenterSentinel, catchUpPrompt, isAutomaticPresenterSentinel, isNoUpdateResponse, latestNotificationsBySession, markSupersededNotificationsRead, nextCatchUp, pendingNotifications, shouldScheduleWorkspaceCatchUp } = require('../electron/agent/catch-up.cjs');

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

test('session state uses the newest retained event across distinct kinds', () => {
  const notifications = [
    { id: 'older-completion', sessionId: 'one', kind: 'COMPLETED', createdAt: 10, read: false },
    { id: 'newer-failure', sessionId: 'one', kind: 'FAILED', createdAt: 20, read: false }
  ];
  assert.equal(latestNotificationsBySession(notifications).get('one').id, 'newer-failure');
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
  assert.equal(automaticPresenterSentinel("One session is working, and another is waiting on PR 709. Nothing needs your attention right now."), 'NO_UPDATE');
  assert.equal(automaticPresenterSentinel('You are all caught up.'), 'NO_UPDATE');
  assert.equal(automaticPresenterSentinel('Nothing needs your attention except the failed deployment.'), '');
});

test('automatic updates wait for final classification before presentation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const proactive = main.match(/async function runProactiveCatchUp[\s\S]*?function scheduleProactiveCatchUp/)?.[0] || '';
  assert.doesNotMatch(proactive, /onTextDelta/);
  assert.doesNotMatch(proactive, /SentenceBuffer/);
  assert.match(proactive, /await chatWithSupervisor[\s\S]*if \(voice && result\.speech\) queueSpeech\(result\.speech\)/);
});

test('a stale completion is suppressed while its live session is still working', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function liveSessionStillWorking\(sessionId\)[\s\S]*waiting[\s\S]*to\\s\+interrupt/);
  assert.match(main, /const staleCompletion = Boolean\([\s\S]*item\.kind === 'COMPLETED'[\s\S]*liveSessionStillWorking\(item\.sessionId\)/);
  assert.match(main, /if \(event\.kind === 'COMPLETED' && liveSessionStillWorking\(event\.sessionId\)\)[\s\S]*acknowledge\(\)/);
});

test('voice activation does not pre-ping before finding an actionable update', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const activation = main.match(/async function performVoiceActivationUpdate[\s\S]*?async function requestVoiceActivationUpdate/)?.[0] || '';
  assert.doesNotMatch(activation, /one sec|checking the latest/i);
  assert.match(activation, /automatic: true/);
  assert.match(activation, /if \(!result\.speech\) return/);
});

test('proactive enrichment also suppresses presenter sentinels', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const presenterSentinel = automatic \|\| proactive \? automaticPresenterSentinel\(result\.text\) : ''/);
});

test('final catch-up may ask what to do next', () => {
  assert.match(catchUpPrompt({ id: 'last' }, 0), /final pending update/);
  assert.equal(catchUpPrompt(null), '');
});

test('proactive enrichment yields to higher-priority user work', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /if \(result\.needsEnrichment\) \{[\s\S]*?notificationIds: \[event\.id\],[\s\S]*?interruptible: true/);
  assert.match(main, /catch \(error\) \{[\s\S]*transition\(event\.id, 'queued'\)[\s\S]*if \(activation\.taskId\) queueMicrotask\(scheduleProactiveCatchUp\)/);
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
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?recoverAbandonedAgentStateEvents\(\);/);
});

test('persisted unread updates are scheduled once after workspace restoration', () => {
  assert.equal(shouldScheduleWorkspaceCatchUp({ unreadCount: 1, initialized: false }), true);
  assert.equal(shouldScheduleWorkspaceCatchUp({ unreadCount: 1, initialized: true }), false);
  assert.equal(shouldScheduleWorkspaceCatchUp({ addedCount: 1, unreadCount: 1, initialized: true }), true);
});
