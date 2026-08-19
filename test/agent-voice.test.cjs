const assert = require('node:assert/strict');
const test = require('node:test');
const { VOICE_MODE_INSTRUCTION, speechSummary } = require('../electron/agent/voice.cjs');

test('voice mode requests a short conversational response', () => {
  assert.match(VOICE_MODE_INSTRUCTION, /two short sentences/);
  assert.match(VOICE_MODE_INSTRUCTION, /Do not use Markdown/);
});

test('spoken responses remove Markdown and bound long output', () => {
  const spoken = speechSummary('**PR fixed**\n- Tests pass.\n- See [PR](https://github.com/a/b/pull/1).');
  assert.equal(spoken, 'PR fixed Tests pass. See PR.');
  assert.ok(speechSummary(Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')).split(' ').length <= 55);
});
