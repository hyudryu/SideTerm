const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateLegacyPullRequestWatches, WatchManager, watchIsDue, watchLifecycleIsDue } = require('../electron/watches/manager.cjs');

test('Codex watch terminates at approval and rearms for a new head', () => {
  const watches = [];
  const manager = new WatchManager(watches, { createId: () => 'watch-1', now: () => 10 });
  const watch = manager.create({ kind: 'github_codex_review', repo: 'a/b', prNumber: 9, exitCondition: 'codex_thumbs_up', headSha: 'one' });
  manager.conditionMet(watch.id, 'approved:one', 'one');
  assert.equal(manager.active().length, 0);
  manager.rearm(watch.id, 'two');
  assert.equal(manager.active().length, 1);
  assert.equal(watch.headSha, 'two');
});

test('a cancelled watch is distinguishable from a met condition', () => {
  const watches = [];
  const manager = new WatchManager(watches, { createId: () => 'watch-1', now: () => 42 });
  const watch = manager.create({ kind: 'github_codex_review', repo: 'a/b', prNumber: 9 });
  manager.cancel(watch.id);
  assert.equal(watch.state, 'terminal');
  assert.equal(watch.cancelledAt, 42);
});

test('terminal review watches retain a lifecycle poll but cancelled watches do not', () => {
  const watches = [];
  const manager = new WatchManager(watches, { createId: () => 'watch-1', now: () => 10 });
  const watch = manager.create({ kind: 'github_codex_review', repo: 'a/b', prNumber: 9, lastCheckedAt: 10 });
  manager.conditionMet(watch.id, 'approved:one', 'one');
  assert.equal(watchIsDue(watch, 60_010), false);
  assert.equal(watchLifecycleIsDue(watch, 60_010), true);
  manager.cancel(watch.id);
  assert.equal(watchLifecycleIsDue(watch, 120_010), false);
});

test('explicit creation can reactivate a cancelled watch at its requested cadence', () => {
  const watches = [];
  const manager = new WatchManager(watches, { createId: () => 'watch-1', now: () => 120_000 });
  const watch = manager.create({ kind: 'github_codex_review', repo: 'a/b', prNumber: 9, headSha: 'one' });
  manager.cancel(watch.id);
  manager.activate(watch.id, { headSha: 'one', intervalSeconds: 300 });
  manager.markChecked(watch.id, 120_000);
  assert.equal(watch.cancelledAt, 0);
  assert.equal(watch.intervalSeconds, 300);
  assert.equal(watchIsDue(watch, 419_999), false);
  assert.equal(watchIsDue(watch, 420_000), true);
});

test('legacy open pull requests migrate into active Codex watches', () => {
  const watches = [];
  const migrated = migrateLegacyPullRequestWatches(watches, [{
    url: 'https://github.com/a/b/pull/9', number: 9, state: 'open', headSha: 'abc', lastCheckedAt: 100
  }], { createId: () => 'legacy-watch', now: () => 200 });
  assert.equal(migrated.length, 1);
  assert.deepEqual(watches[0], {
    id: watches[0].id, kind: 'github_codex_review', repo: 'a/b', prNumber: 9,
    intervalSeconds: 60, state: 'active', exitCondition: 'codex_thumbs_up', lastFingerprint: '',
    headSha: 'abc', lastCheckedAt: 100, cancelledAt: 0, createdAt: 100, updatedAt: 200
  });
  assert.match(watches[0].id, /^legacy-github-[0-9a-f]{24}$/);
  const repeated = [];
  migrateLegacyPullRequestWatches(repeated, [{
    url: 'https://github.com/a/b/pull/9', number: 9, state: 'open'
  }]);
  assert.equal(repeated[0].id, watches[0].id);
  assert.equal(migrateLegacyPullRequestWatches(watches, [{
    url: 'https://github.com/a/b/pull/9', state: 'open'
  }]).length, 0);
});
