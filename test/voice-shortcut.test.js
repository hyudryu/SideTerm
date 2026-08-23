import assert from 'node:assert/strict';
import test from 'node:test';
import { isVoiceShortcutBypassActive } from '../src/voice-shortcut.js';

test('voice shortcut bypass is claimed from the utterance start time', () => {
  assert.equal(isVoiceShortcutBypassActive(20_000, 19_999), true);
  assert.equal(isVoiceShortcutBypassActive(20_000, 20_000), true);
  assert.equal(isVoiceShortcutBypassActive(20_000, 20_001), false);
  assert.equal(isVoiceShortcutBypassActive(0, 10_000), false);
});
