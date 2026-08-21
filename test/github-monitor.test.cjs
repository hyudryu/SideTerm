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
  isActionableCodexComment,
  isCodexAuthor,
  mergePullRequest,
  parsePullRequestUrl,
  parseJsonLines,
  pullRequestChanged,
  reactionSummary,
  reconcileCodexApproval,
  shouldPollPullRequest,
  successfulGitCommit
} = require('../electron/github/pr-monitor.cjs');

test('GitHub monitor accepts only canonical pull request URLs', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/hyudryu/SideTerm/pull/2'), {
    owner: 'hyudryu', repo: 'SideTerm', number: 2, url: 'https://github.com/hyudryu/SideTerm/pull/2'
  });
  assert.throws(() => parsePullRequestUrl('https://github.com/hyudryu/SideTerm/issues/2'), /pull request URL/);
});

test('approved merge actions execute the canonical pull request once', async () => {
  const calls = [];
  const result = await mergePullRequest('https://github.com/hyudryu/SideTerm/pull/11', {
    headSha: 'abcdef1234567890',
    runGh: async (args, options) => {
      calls.push({ args, options });
      if (args[0] === 'api') return '{"allow_merge_commit":true,"allow_squash_merge":true,"allow_rebase_merge":true}';
      return args[1] === 'view' ? '{"state":"OPEN"}' : '';
    }
  });
  assert.deepEqual(result, {
    merged: false, submitted: true, state: 'OPEN', url: 'https://github.com/hyudryu/SideTerm/pull/11',
    number: 11, headSha: 'abcdef1234567890'
  });
  assert.deepEqual(calls[0].args, ['api', 'repos/hyudryu/SideTerm']);
  assert.deepEqual(calls[1], {
    args: ['pr', 'merge', 'https://github.com/hyudryu/SideTerm/pull/11', '--merge', '--match-head-commit', 'abcdef1234567890'],
    options: { owner: 'hyudryu', timeout: 120_000 }
  });
  assert.deepEqual(calls[2].args, ['pr', 'view', 'https://github.com/hyudryu/SideTerm/pull/11', '--json', 'state']);
  await assert.rejects(mergePullRequest('https://github.com/hyudryu/SideTerm/pull/11', {
    runGh: async () => ''
  }), /approved pull-request revision/);
});

test('approved merge actions select a repository-enabled strategy', async () => {
  const calls = [];
  await mergePullRequest('https://github.com/hyudryu/SideTerm/pull/11', {
    headSha: 'abcdef1234567890',
    runGh: async (args) => {
      calls.push(args);
      if (args[0] === 'api') return '{"allow_merge_commit":false,"allow_squash_merge":true,"allow_rebase_merge":true}';
      return args[1] === 'view' ? '{"state":"MERGED"}' : '';
    }
  });
  assert.deepEqual(calls[1], [
    'pr', 'merge', 'https://github.com/hyudryu/SideTerm/pull/11', '--squash', '--match-head-commit', 'abcdef1234567890'
  ]);
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

test('approval prompts are tied to the approved remote head and reset when withdrawn', () => {
  const approved = { headSha: 'aaaa1111', reactions: [{ name: '+1', count: 1, authors: ['codex[bot]'] }] };
  const initial = reconcileCodexApproval(null, approved);
  assert.equal(initial.shouldPrompt, true);

  const prompted = { ...approved, ...initial, mergePrompted: true, mergePromptedHeadSha: approved.headSha };
  assert.equal(reconcileCodexApproval(prompted, approved).shouldPrompt, false);

  const withdrawn = { ...approved, reactions: [] };
  const reset = reconcileCodexApproval(prompted, withdrawn);
  assert.equal(reset.mergePrompted, false);
  const restored = reconcileCodexApproval({ ...withdrawn, ...reset }, approved);
  assert.equal(restored.shouldPrompt, true);
});

test('withdrawn approval retires the pending merge interaction', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /else if \(!approval\.ready\) \{\s*retireMergeConfirmations\(state, snapshot\.url\)/);
});

test('an approval on the remote revision is not offered while a local commit is unpushed', () => {
  const oldHead = { headSha: 'aaaa1111', reactions: [{ name: '+1', count: 1, authors: ['codex[bot]'] }] };
  const pending = reconcileCodexApproval(null, oldHead, 'bbbb2222');
  assert.equal(pending.shouldPrompt, false);
  assert.equal(pending.pendingLocalHeadSha, 'bbbb2222');

  const newHead = { ...oldHead, headSha: 'bbbb2222' };
  const synchronized = reconcileCodexApproval({ ...oldHead, ...pending }, newHead);
  assert.equal(synchronized.pendingLocalHeadSha, '');
  assert.equal(synchronized.shouldPrompt, false, 'the old reaction is not treated as approval of the new head');

  const removed = reconcileCodexApproval({ ...newHead, ...synchronized }, { ...newHead, reactions: [] });
  const reapproved = reconcileCodexApproval({ ...newHead, reactions: [], ...removed }, newHead);
  assert.equal(reapproved.shouldPrompt, true);
});

test('approval-only Codex reviews are not actionable fix requests', () => {
  assert.equal(isActionableCodexComment({ author: 'chatgpt-codex-connector', kind: 'review', state: 'APPROVED', body: '' }), false);
  assert.equal(isActionableCodexComment({ author: 'chatgpt-codex-connector', kind: 'review', state: 'APPROVED', body: 'Looks good' }), false);
  assert.equal(isActionableCodexComment({ author: 'chatgpt-codex-connector', kind: 'review-comment', body: 'Handle the null case.' }), true);
});

test('successful git commit output can enroll its branch pull request', () => {
  assert.equal(successfulGitCommit('[main abc1234] Ship voice fixes\n 2 files changed'), 'abc1234');
  assert.equal(successfulGitCommit('[feature (root-commit) abcdef123456] Initial commit'), 'abcdef123456');
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
  assert.equal(shouldPollPullRequest({ state: 'open', headSha: 'abc', codexApprovalHeadSha: 'abc' }), true);
  assert.equal(shouldPollPullRequest({ state: 'open', headSha: 'def', codexApprovalHeadSha: 'abc' }), true);
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
