const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { claimConfirmation, reconcileConfirmationInteractions, restoreConfirmation, retirePullRequestConfirmations } = require('../electron/agent/confirmation-state.cjs');

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
