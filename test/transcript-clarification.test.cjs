const test = require('node:test');
const assert = require('node:assert/strict');
const { closestVocabularyTerm, transcriptClarification } = require('../electron/voice/transcript-clarification.cjs');

test('active coding vocabulary produces a colloquial did-you-mean prompt', () => {
  assert.equal(closestVocabularyTerm('ask code x to review it', ['Codex']).term, 'Codex');
  const result = transcriptClarification('ask code x to review it', ['Codex']);
  assert.match(result.prompt, /did you mean “ask Codex x to review it”/i);
});

test('known wrong-language recognition asks about the intended acknowledgement', () => {
  const result = transcriptClarification('Obrigado', []);
  assert.equal(result.suggestedText, 'Okay, thank you');
  assert.match(result.prompt, /did you mean/i);
});

test('ordinary confident transcripts continue without clarification', () => {
  assert.equal(transcriptClarification('Please run the tests', ['Codex'], { confidence: 0.9 }), null);
});
