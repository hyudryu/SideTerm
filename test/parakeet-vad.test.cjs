const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Parakeet silence probability is derived from the canonical WAV', () => {
  const sidecar = fs.readFileSync(path.join(__dirname, '..', 'electron', 'voice', 'sidecar.py'), 'utf8');
  assert.match(sidecar, /def wav_speech_metrics\(input_path\):/);
  assert.match(sidecar, /no_speech_probability, duration = wav_speech_metrics\(args\.input\)/);
  assert.doesNotMatch(sidecar, /"noSpeechProbability": 0\.0 if text else 1\.0/);
});
