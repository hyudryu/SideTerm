const assert = require('node:assert/strict');
const test = require('node:test');
const { inferEventKind } = require('../electron/supervisor/outcome.cjs');

test('outcome classification trusts the final summary over retained failures', () => {
  assert.equal(inferEventKind({ summary: 'Implemented the fix. All tests pass.', context: 'Earlier test failed with an error.' }), 'COMPLETED');
  assert.equal(inferEventKind({ context: 'old error\nwork continued\nTests passed with 0 errors' }), 'COMPLETED');
  assert.equal(inferEventKind({ summary: 'Tests failed with 2 errors.' }), 'FAILED');
});
