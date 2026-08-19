const assert = require('node:assert/strict');
const test = require('node:test');
const { claimConfirmation, restoreConfirmation } = require('../electron/agent/confirmation-state.cjs');

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
