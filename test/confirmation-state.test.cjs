const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { claimConfirmation, compactCodexReviewHandoffs, reconcileConfirmationInteractions, restoreConfirmation, retirePullRequestConfirmations } = require('../electron/agent/confirmation-state.cjs');

test('a confirmation can only be claimed once', () => {
  const state = { confirmations: [{ id: 'one', body: 'post once' }] };
  assert.equal(claimConfirmation(state, 'one').body, 'post once');
  assert.throws(() => claimConfirmation(state, 'one'), /no longer pending/);
});

test('cancelling a Codex watch also retires its merge interaction', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /watchCancel\(\{ watchId \}\)[\s\S]*retireMergeConfirmations\(state, `https:\/\/github\.com\/\$\{watch\.repo\}\/pull\/\$\{Number\(watch\.prNumber\)\}`\)/);
});

test('durable PR projections retain one record for every supported watch', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /parsed\.pullRequests\) \? parsed\.pullRequests\.slice\(-120\)/);
  assert.match(main, /state\.pullRequests\.length > 120/);
});

test('a failed action restores its confirmation idempotently', () => {
  const confirmation = { id: 'one' };
  const state = { confirmations: [] };
  restoreConfirmation(state, confirmation);
  restoreConfirmation(state, confirmation);
  assert.deepEqual(state.confirmations, [confirmation]);
});

test('closing a pull request retires only its merge confirmations', () => {
  const state = { confirmations: [
    { id: 'merge-1', kind: 'merge-pull-request', pullRequestUrl: 'https://github.com/acme/repo/pull/1' },
    { id: 'merge-2', kind: 'merge-pull-request', pullRequestUrl: 'https://github.com/acme/repo/pull/2' },
    { id: 'comment', kind: 'github-comment', pullRequestUrl: 'https://github.com/acme/repo/pull/1' }
  ] };
  assert.deepEqual(retirePullRequestConfirmations(state, 'https://github.com/acme/repo/pull/1').map((item) => item.id), ['merge-1']);
  assert.deepEqual(state.confirmations.map((item) => item.id), ['merge-2', 'comment']);
});

test('orphaned approval interactions and their events are retired together', () => {
  const state = {
    confirmations: [{ id: 'evicted-confirmation' }, { id: 'kept' }],
    interactions: [
      { id: 'evicted', kind: 'approval', state: 'awaiting_answer', priority: 0, createdAt: 1 },
      { id: 'kept', kind: 'approval', state: 'queued', priority: 1, createdAt: 2 }
    ],
    notifications: [{ id: 'event', state: 'queued', read: false, payload: { interactionId: 'evicted' } }],
    activeInteractionId: 'evicted'
  };
  assert.deepEqual([...reconcileConfirmationInteractions(state)], ['evicted-confirmation', 'evicted']);
  assert.deepEqual(state.confirmations.map((item) => item.id), ['kept']);
  assert.deepEqual(state.interactions.map((item) => item.id), ['kept']);
  assert.equal(state.notifications[0].state, 'acknowledged');
  assert.equal(state.notifications[0].read, true);
  assert.equal(state.activeInteractionId, 'kept');
  assert.equal(state.interactions[0].state, 'presented');
});

test('an answered approval stays paired while its action is in flight', () => {
  const state = {
    confirmations: [],
    interactions: [{ id: 'claimed', kind: 'approval', state: 'answered' }],
    notifications: [],
    activeInteractionId: ''
  };
  reconcileConfirmationInteractions(state);
  assert.equal(state.interactions[0].id, 'claimed');
});

test('legacy confirmations gain approval interactions before pair reconciliation', () => {
  const state = {
    confirmations: [{ id: 'legacy', kind: 'archive', title: 'Old terminal', createdAt: 10 }],
    interactions: [],
    notifications: [],
    activeInteractionId: ''
  };
  reconcileConfirmationInteractions(state, { migrateLegacy: true });
  assert.equal(state.confirmations[0].id, 'legacy');
  assert.equal(state.interactions[0].id, 'legacy');
  assert.equal(state.interactions[0].kind, 'approval');
  assert.equal(state.activeInteractionId, 'legacy');
});

test('Codex review handoffs compact to one pending task per pull request', () => {
  const input = (number) => `Please inspect the latest Codex review comments on https://github.com/acme/repo/pull/${number}. Address every valid finding.`;
  const state = {
    confirmations: [
      { id: 'old', kind: 'terminal-input', pullRequestUrl: 'https://github.com/acme/repo/pull/7', input: input(7), createdAt: 1 },
      { id: 'new', kind: 'terminal-input', pullRequestUrl: 'https://github.com/acme/repo/pull/7', input: input(7), createdAt: 2 },
      { id: 'other', kind: 'terminal-input', pullRequestUrl: 'https://github.com/acme/repo/pull/8', input: input(8), createdAt: 1 }
    ],
    interactions: [
      { id: 'old', kind: 'approval', state: 'awaiting_answer', priority: 0, createdAt: 1 },
      { id: 'new', kind: 'approval', state: 'awaiting_answer', priority: 0, createdAt: 2 },
      { id: 'other', kind: 'approval', state: 'awaiting_answer', priority: 0, createdAt: 3 }
    ],
    notifications: [{ id: 'old-event', state: 'queued', read: false, payload: { interactionId: 'old' } }],
    pullRequests: [{ url: 'https://github.com/acme/repo/pull/7', headSha: 'current-head' }],
    activeInteractionId: 'old'
  };
  assert.deepEqual([...compactCodexReviewHandoffs(state)], ['old']);
  assert.deepEqual(state.confirmations.map((item) => item.id), ['new', 'other']);
  assert.equal(state.confirmations[0].source, 'codex-review-handoff');
  assert.equal(state.confirmations[0].handoffKey, 'codex-review-handoff:https://github.com/acme/repo/pull/7');
  assert.equal(state.confirmations[0].headSha, 'current-head');
  assert.equal(state.pullRequests[0].codexReviewPromptedHeadSha, 'current-head');
  assert.equal(state.notifications[0].read, true);
  assert.equal(state.activeInteractionId, 'new');
});
