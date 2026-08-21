const assert = require('node:assert/strict');
const test = require('node:test');
const { claimConfirmation, restoreConfirmation, retirePullRequestConfirmations } = require('../electron/agent/confirmation-state.cjs');

test('a confirmation can only be claimed once', () => {
  const state = { confirmations: [{ id: 'one', body: 'post once' }] };
  assert.equal(claimConfirmation(state, 'one').body, 'post once');
  assert.throws(() => claimConfirmation(state, 'one'), /no longer pending/);
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
