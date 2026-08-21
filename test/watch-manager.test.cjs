const test = require('node:test');
const assert = require('node:assert/strict');
const { WatchManager } = require('../electron/watches/manager.cjs');

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
