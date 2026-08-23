const assert = require('node:assert/strict');
const test = require('node:test');
const { formatBytes, parsePipProgress } = require('../electron/voice/install-progress.cjs');

test('parses pip raw progress lines into percentages', () => {
  assert.equal(parsePipProgress('Progress 0 of 12464674\r\n'), 0);
  assert.equal(parsePipProgress('Progress 4456448 of 12464674'), 36);
  assert.equal(parsePipProgress('Progress 12464674 of 12464674'), 100);
});

test('ignores non-progress output and degenerate totals', () => {
  assert.equal(parsePipProgress('Downloading numpy-2.5.2.whl (12.5 MB)'), null);
  assert.equal(parsePipProgress('Progress 10 of 0'), null);
  assert.equal(parsePipProgress(''), null);
});

test('clamps runaway progress to 100', () => {
  assert.equal(parsePipProgress('Progress 99999 of 100'), 100);
});

test('formats byte counts for the model download phase', () => {
  assert.equal(formatBytes(0), '1 KB');
  assert.equal(formatBytes(500_000), '500 KB');
  assert.equal(formatBytes(12_500_000), '13 MB');
  assert.equal(formatBytes(2_400_000_000), '2.4 GB');
});
