const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldRetainVisionCredential } = require('../electron/perception/credentials.cjs');

test('vision credentials never cross endpoint origins without replacement', () => {
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://one.test/other'), true);
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://two.test/v1'), false);
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://two.test/v1', 'new-key'), true);
});
