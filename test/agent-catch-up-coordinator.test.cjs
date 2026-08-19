const assert = require('node:assert/strict');
const test = require('node:test');
const { createCatchUpCoordinator } = require('../electron/agent/catch-up-coordinator.cjs');

test('one mobile client owns the catch-up queue until it is drained', () => {
  const coordinator = createCatchUpCoordinator();
  const phone = {};
  const tablet = {};

  assert.equal(coordinator.claim(phone), 'claimed');
  assert.equal(coordinator.claim(tablet), 'owned');
  assert.equal(coordinator.finish(phone, { hasMore: true }), true);
  assert.equal(coordinator.claim(tablet), 'owned');
  assert.equal(coordinator.claim(phone), 'claimed');
  assert.equal(coordinator.finish(phone, { hasMore: false }), true);
  assert.equal(coordinator.claim(tablet), 'claimed');
});

test('duplicate owner requests and explicit release are safe', () => {
  const coordinator = createCatchUpCoordinator();
  const phone = {};

  assert.equal(coordinator.claim(phone), 'claimed');
  assert.equal(coordinator.claim(phone), 'busy');
  assert.equal(coordinator.release({}), false);
  assert.equal(coordinator.release(phone), true);
  assert.equal(coordinator.claim(phone), 'claimed');
});
