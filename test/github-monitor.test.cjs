const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  changedPullRequestComments,
  commentRevisionKey,
  flattenPages,
  githubCliAvailable,
  githubRepositoryOwner,
  hasCodexThumbsUp,
  isCodexAuthor,
  parsePullRequestUrl,
  parseJsonLines,
  pullRequestChanged,
  reactionSummary,
  shouldPollPullRequest,
  successfulGitCommit
} = require('../electron/github/pr-monitor.cjs');

test('GitHub monitor accepts only canonical pull request URLs', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/hyudryu/SideTerm/pull/2'), {
    owner: 'hyudryu', repo: 'SideTerm', number: 2, url: 'https://github.com/hyudryu/SideTerm/pull/2'
  });
  assert.throws(() => parsePullRequestUrl('https://github.com/hyudryu/SideTerm/issues/2'), /pull request URL/);
});

test('GitHub main-post reactions retain emoji, counts, and authors', () => {
  assert.deepEqual(reactionSummary([
    { content: 'eyes', user: { login: 'codex[bot]' } },
    { content: 'eyes', user: { login: 'reviewer' } },
    { content: 'rocket', user: { login: 'reviewer' } }
  ]), [
    { name: 'eyes', emoji: '👀', count: 2, authors: ['codex[bot]', 'reviewer'] },
    { name: 'rocket', emoji: '🚀', count: 1, authors: ['reviewer'] }
  ]);
});

test('a Codex thumbs-up on the main post marks the pull request merge-ready', () => {
  assert.equal(hasCodexThumbsUp({ reactions: [{ name: '+1', count: 1, authors: ['codex[bot]'] }] }), true);
  assert.equal(hasCodexThumbsUp({ reactions: [{ name: '+1', count: 1, authors: ['human-reviewer'] }] }), false);
});

test('new and edited comments are detected without replaying unchanged comments', () => {
  const previous = { comments: [{ id: 'one', updatedAt: '1', body: 'before', state: '' }] };
  const next = { comments: [
    { id: 'one', updatedAt: '2', body: 'after', state: '' },
    { id: 'two', updatedAt: '2', body: 'new', state: 'COMMENTED' }
  ] };
  assert.deepEqual(changedPullRequestComments(previous, next).map((item) => item.id), ['one', 'two']);
  assert.notEqual(commentRevisionKey(previous.comments[0]), commentRevisionKey(next.comments[0]));
  assert.equal(commentRevisionKey(next.comments[0]), commentRevisionKey({ ...next.comments[0] }));
});

test('successful git commit output can enroll its branch pull request', () => {
  assert.match(successfulGitCommit('[main abc1234] Ship voice fixes\n 2 files changed'), /abc1234/);
  assert.match(successfulGitCommit('[feature (root-commit) abcdef123456] Initial commit'), /abcdef123456/);
  assert.equal(successfulGitCommit('nothing to commit, working tree clean'), '');
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

test('repository owners are resolved from HTTPS and SSH GitHub remotes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-github-owner-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: directory });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:hyudryu/SideTerm.git'], { cwd: directory });
    assert.equal(githubRepositoryOwner(directory), 'hyudryu');
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/openai/codex.git'], { cwd: directory });
    assert.equal(githubRepositoryOwner(directory), 'openai');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
