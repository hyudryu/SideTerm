const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldRetainVisionCredential, visionEndpointConfigurationError } = require('../electron/perception/credentials.cjs');

test('vision credentials never cross endpoint origins without replacement', () => {
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://one.test/other'), true);
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://two.test/v1'), false);
  assert.equal(shouldRetainVisionCredential('https://one.test/v1', 'https://two.test/v1', 'new-key'), true);
});

test('remote vision endpoints require encrypted transport', () => {
  assert.match(visionEndpointConfigurationError('http://vision.example.test/v1'), /must use HTTPS/);
  assert.equal(visionEndpointConfigurationError('https://vision.example.test/v1'), '');
  assert.equal(visionEndpointConfigurationError('http://127.0.0.1:9000/v1'), '');
  assert.equal(visionEndpointConfigurationError('http://localhost:9000/v1'), '');
});
