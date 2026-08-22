const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('desktop and mobile cap sustained speech without waiting for silence', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  const durationGuard = /if \(speaking && \(now - startedAt > 14_000 \|\| \(silenceAt && now - silenceAt > 850\)\)\)/;
  assert.match(desktop, durationGuard);
  assert.match(mobile, durationGuard);
});
