const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allowsImmediateVoiceExecution,
  applyWakeWord,
  VoiceAcknowledgementPicker,
  VOICE_ACKNOWLEDGEMENTS,
  VOICE_MODE_INSTRUCTION,
  VOICE_EXECUTION_INSTRUCTION,
  speechSummary
} = require('../electron/agent/voice.cjs');

test('voice mode requests a short conversational response', () => {
  assert.match(VOICE_MODE_INSTRUCTION, /one or two short sentences/);
  assert.match(VOICE_MODE_INSTRUCTION, /Do not use Markdown/);
  assert.match(VOICE_MODE_INSTRUCTION, /casual, conversational/);
  assert.match(VOICE_MODE_INSTRUCTION, /contractions/);
  assert.match(VOICE_MODE_INSTRUCTION, /Do not narrate tool use/);
  assert.match(VOICE_MODE_INSTRUCTION, /useful result or need the user's input/);
});

test('direct voice acknowledgements vary without repeating consecutively', () => {
  const picker = new VoiceAcknowledgementPicker({ random: () => 0 });
  const first = picker.next();
  const second = picker.next();
  const third = picker.next();
  assert.ok(VOICE_ACKNOWLEDGEMENTS.includes(first));
  assert.notEqual(second, first);
  assert.notEqual(third, second);
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

test('the wake word is required for an unsolicited request and removed when present', () => {
  assert.deepEqual(applyWakeWord('What changed?', 'Hey Agent'), {
    ignored: true,
    reason: 'Wake word “Hey Agent” was not detected.'
  });
  assert.deepEqual(applyWakeWord('Hey Agent, what changed?', 'Hey Agent'), {
    ignored: false,
    text: 'what changed?'
  });
});

test('a direct reply can bypass the wake word', () => {
  assert.deepEqual(applyWakeWord('Yes, run the tests.', 'Hey Agent', { allowWithoutWakeWord: true }), {
    ignored: false,
    text: 'Yes, run the tests.'
  });
});

test('spoken responses remove Markdown and bound long output', () => {
  const spoken = speechSummary('**PR fixed**\n- Tests pass.\n- See [PR](https://github.com/a/b/pull/1).');
  assert.equal(spoken, 'PR fixed Tests pass. See PR.');
  assert.ok(speechSummary(Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')).split(' ').length <= 40);
});
