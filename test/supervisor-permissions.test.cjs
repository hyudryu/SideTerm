const test = require('node:test');
const assert = require('node:assert/strict');
const { ALLOW, ASK_USER, DENY, authorize, createApprovalToken } = require('../electron/supervisor/permissions.cjs');

test('level-two policy allows reads and asks for destructive actions', () => {
  assert.equal(authorize({ kind: 'SESSION_READ' }), ALLOW);
  assert.equal(authorize({ kind: 'RUN_TESTS' }), ALLOW);
  assert.equal(authorize({ kind: 'RAW_TERMINAL_INPUT', input: 'git push --force' }), ASK_USER);
  assert.equal(authorize({ kind: 'MERGE_PR', number: 9 }), ASK_USER);
  assert.equal(authorize({ kind: 'SESSION_READ' }, { untrustedInstruction: true }), DENY);
});

test('approval token is action-specific', () => {
  const action = { kind: 'MERGE_PR', number: 9 };
  const token = createApprovalToken(action, { now: () => 10, ttlMs: 1000 });
  assert.equal(authorize(action, { approvalToken: token, now: () => 20 }), ALLOW);
  assert.equal(authorize({ kind: 'MERGE_PR', number: 10 }, { approvalToken: token, now: () => 20 }), ASK_USER);
});
