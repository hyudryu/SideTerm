const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('reverting a vision endpoint compares against the persisted origin', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /visionKeyPersistedEndpoint = settings\.visionApiUrl \|\| ''/);
  assert.match(renderer, /const draftOrigin = visionEndpointOrigin\(event\.target\.value\);\s*const endpointChanged = draftOrigin !== visionEndpointOrigin\(visionKeyPersistedEndpoint\)/);
  assert.match(renderer, /else \{\s*clearVisionApiKeyRequested = visionKeyExplicitClearRequested/);
  assert.match(renderer, /visionReplacementKeyOrigin = event\.target\.value[\s\S]*visionEndpointOrigin\(document\.querySelector\('#vision-api-url'\)\.value\)/);
  assert.match(renderer, /if \(keyInput\.value && visionReplacementKeyOrigin !== draftOrigin\) \{\s*keyInput\.value = '';\s*visionReplacementKeyOrigin = '';/);
  assert.match(renderer, /if \(endpointChanged\) \{\s*clearVisionApiKeyRequested = !keyInput\.value/);
  assert.match(renderer, /else if \(keyInput\.value\) \{[\s\S]*Replacement key ready/);
  assert.doesNotMatch(renderer, /const keyInput = document\.querySelector\('#vision-api-key'\);\s*keyInput\.value = '';/);
  assert.doesNotMatch(renderer, /visionKeyEndpointDraft/);
});
