const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allowsImmediateVoiceExecution,
  VOICE_MODE_INSTRUCTION,
  VOICE_EXECUTION_INSTRUCTION,
  speechSummary
} = require('../electron/agent/voice.cjs');

test('voice mode requests a short conversational response', () => {
  assert.match(VOICE_MODE_INSTRUCTION, /one or two short sentences/);
  assert.match(VOICE_MODE_INSTRUCTION, /Do not use Markdown/);
  assert.match(VOICE_MODE_INSTRUCTION, /casual, conversational/);
  assert.match(VOICE_MODE_INSTRUCTION, /contractions/);
});

test('voice execution tells the agent spoken requests are the approval', () => {
  assert.match(VOICE_EXECUTION_INSTRUCTION, /spoken request is the approval/);
  assert.match(VOICE_EXECUTION_INSTRUCTION, /executes immediately/);
  assert.match(VOICE_EXECUTION_INSTRUCTION, /Never tell the user to click Approve/);
});

test('only a directly transcribed spoken request can bypass confirmation', () => {
  assert.equal(allowsImmediateVoiceExecution(true), true);
  assert.equal(allowsImmediateVoiceExecution(false), false);
  assert.equal(allowsImmediateVoiceExecution(undefined), false);
  assert.equal(allowsImmediateVoiceExecution('true'), false);
});

test('spoken responses remove Markdown and bound long output', () => {
  const spoken = speechSummary('**PR fixed**\n- Tests pass.\n- See [PR](https://github.com/a/b/pull/1).');
  assert.equal(spoken, 'PR fixed Tests pass. See PR.');
  assert.ok(speechSummary(Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')).split(' ').length <= 40);
});
