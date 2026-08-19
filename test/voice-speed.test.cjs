const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_VOICE_SPEED,
  normalizeVoiceSpeed
} = require('../electron/voice/speed.cjs');

test('voice speed defaults to normal playback', () => {
  assert.equal(normalizeVoiceSpeed(undefined), DEFAULT_VOICE_SPEED);
  assert.equal(normalizeVoiceSpeed('invalid'), DEFAULT_VOICE_SPEED);
});

test('voice speed is bounded and aligned to slider steps', () => {
  assert.equal(normalizeVoiceSpeed(0.2), 0.75);
  assert.equal(normalizeVoiceSpeed(2), 1.5);
  assert.equal(normalizeVoiceSpeed(1.23), 1.25);
  assert.equal(normalizeVoiceSpeed('1.4'), 1.4);
});
