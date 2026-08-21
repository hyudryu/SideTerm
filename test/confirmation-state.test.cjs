const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { claimConfirmation, restoreConfirmation, retirePullRequestConfirmations } = require('../electron/agent/confirmation-state.cjs');

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
