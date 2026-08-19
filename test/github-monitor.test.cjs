const assert = require('node:assert/strict');
const test = require('node:test');
const {
  flattenPages,
  githubCliAvailable,
  isCodexAuthor,
  parsePullRequestUrl,
  parseJsonLines,
  pullRequestChanged,
  reactionSummary,
  shouldPollPullRequest
} = require('../electron/github/pr-monitor.cjs');

test('GitHub monitor accepts only canonical pull request URLs', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/hyudryu/SideTerm/pull/2'), {
    owner: 'hyudryu', repo: 'SideTerm', number: 2, url: 'https://github.com/hyudryu/SideTerm/pull/2'
  });
  assert.throws(() => parsePullRequestUrl('https://github.com/hyudryu/SideTerm/issues/2'), /pull request URL/);
});

test('GitHub main-post reactions retain emoji and counts', () => {
  assert.deepEqual(reactionSummary([{ content: 'eyes' }, { content: 'eyes' }, { content: 'rocket' }]), [
    { name: 'eyes', emoji: '👀', count: 2 },
    { name: 'rocket', emoji: '🚀', count: 1 }
  ]);
});

test('GitHub collection pages are aggregated', () => {
  assert.deepEqual(flattenPages([[{ id: 1 }], [{ id: 2 }]]), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(flattenPages([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(parseJsonLines('{"id":1}\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
});

test('Codex attribution uses bot identities instead of comment text', () => {
  assert.equal(isCodexAuthor('chatgpt-codex-connector'), true);
  assert.equal(isCodexAuthor('codex[bot]'), true);
  assert.equal(isCodexAuthor('human-reviewer'), false);
});

test('only open pull requests remain on the regular polling loop', () => {
  assert.equal(shouldPollPullRequest({ state: 'open' }), true);
  assert.equal(shouldPollPullRequest({ state: 'closed' }), false);
  assert.equal(shouldPollPullRequest({ state: 'merged' }), false);
});

test('non-comment pull request changes still trigger an update', () => {
  assert.equal(pullRequestChanged({ fingerprint: 'before', commentFingerprint: 'same' }, { fingerprint: 'after', commentFingerprint: 'same' }), true);
  assert.equal(pullRequestChanged({ fingerprint: 'same' }, { fingerprint: 'same' }), false);
});

test('missing GitHub CLI can be detected from PATH', () => {
  assert.equal(githubCliAvailable({ PATH: '/definitely/not/a/real/path' }), false);
});
