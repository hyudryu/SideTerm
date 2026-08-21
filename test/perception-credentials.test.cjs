const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('enabling supervisor-model vision validates the supervisor endpoint', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /if \(visionEnabled && visionUseSupervisorModel\) \{[\s\S]*visionEndpointConfigurationError\(apiUrl\)/);
});

test('unused separate vision endpoints do not block safe settings changes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /if \(visionEnabled && !visionUseSupervisorModel\) \{[\s\S]*visionEndpointConfigurationError\(visionApiUrl\)/);
});
