const test = require('node:test');
const assert = require('node:assert/strict');
const { SentenceBuffer } = require('../electron/supervisor/sentence-buffer.cjs');

test('sentence buffer emits complete sentences as deltas arrive', () => {
  const output = [];
  const buffer = new SentenceBuffer((text) => output.push(text));
  buffer.push('The API is ');
  buffer.push('done. Want me to ');
  assert.deepEqual(output, ['The API is done.']);
  buffer.push('check the PR?');
  assert.deepEqual(output, ['The API is done.', 'Want me to check the PR?']);
});

test('sentence buffer does not present enrichment sentinel', () => {
  const output = [];
  const buffer = new SentenceBuffer((text) => output.push(text));
  buffer.push('NEEDS_ENRICHMENT');
  assert.equal(buffer.flush(), '');
  assert.deepEqual(output, []);
});
