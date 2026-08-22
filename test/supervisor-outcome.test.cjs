const assert = require('node:assert/strict');
const test = require('node:test');
const { inferEventKind, semanticStateForEvent } = require('../electron/supervisor/outcome.cjs');

test('outcome classification trusts the final summary over retained failures', () => {
  assert.equal(inferEventKind({ summary: 'Implemented the fix. All tests pass.', context: 'Earlier test failed with an error.' }), 'COMPLETED');
  assert.equal(inferEventKind({ context: 'old error\nwork continued\nTests passed with 0 errors' }), 'COMPLETED');
  assert.equal(inferEventKind({ summary: 'Tests failed with 2 errors.' }), 'FAILED');
});

test('common nonzero process output is classified as failure', () => {
  assert.equal(inferEventKind({ context: 'npm ERR! Lifecycle script failed' }), 'FAILED');
  assert.equal(inferEventKind({ context: 'Traceback (most recent call last):' }), 'FAILED');
  assert.equal(inferEventKind({ context: 'Process exited with code 1' }), 'FAILED');
});

test('typed events retain their semantic session state', () => {
  assert.equal(semanticStateForEvent('FAILED'), 'failed');
  assert.equal(semanticStateForEvent('BLOCKED'), 'blocked');
  assert.equal(semanticStateForEvent('INPUT_REQUIRED'), 'input_required');
});
