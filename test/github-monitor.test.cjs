const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePullRequestUrl, reactionSummary } = require('../electron/github/pr-monitor.cjs');

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
