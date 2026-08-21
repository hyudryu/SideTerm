const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('reverting a vision endpoint compares against the persisted origin', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /visionKeyPersistedEndpoint = settings\.visionApiUrl \|\| ''/);
  assert.match(renderer, /const endpointChanged = visionEndpointOrigin\(event\.target\.value\) !== visionEndpointOrigin\(visionKeyPersistedEndpoint\)/);
  assert.match(renderer, /else \{\s*clearVisionApiKeyRequested = visionKeyExplicitClearRequested/);
  assert.doesNotMatch(renderer, /visionKeyEndpointDraft/);
});
