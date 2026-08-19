const assert = require('node:assert/strict');
const test = require('node:test');
const { composeSubmittedInput } = require('../electron/agent/terminal-input.cjs');

test('approved input is submitted with Enter by default', () => {
  assert.equal(composeSubmittedInput({ input: 'npm test' }), 'npm test\r');
  assert.equal(composeSubmittedInput({ input: 'npm test', submit: true }), 'npm test\r');
});

test('input that already ends with Enter is not double-submitted', () => {
  assert.equal(composeSubmittedInput({ input: 'npm test\r' }), 'npm test\r');
  assert.equal(composeSubmittedInput({ input: 'npm test\n' }), 'npm test\n');
});

test('submit false types the text without running it', () => {
  assert.equal(composeSubmittedInput({ input: 'npm test', submit: false }), 'npm test');
});

test('unset submit still submits so persisted confirmations keep working', () => {
  assert.equal(composeSubmittedInput({ input: 'git status' }), 'git status\r');
});
