const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionIndex } = require('../electron/sessions/index.cjs');

test('session index keeps canonical identity and monotonic revisions', () => {
  const index = new SessionIndex();
  const first = index.upsert({ id: 'a', title: 'API', status: 'running' });
  const second = index.upsert({ id: 'a', semanticState: 'input_required' });
  assert.equal(second.friendlyName, 'API');
  assert.equal(second.semanticState, 'input_required');
  assert.ok(second.revision > first.revision);
});

test('session index clears a semantic state when the new projection acknowledges it', () => {
  const index = new SessionIndex([{ id: 'a', semanticState: 'completed' }]);
  const current = index.upsert({ id: 'a', semanticState: undefined });
  assert.equal(current.semanticState, undefined);
});
