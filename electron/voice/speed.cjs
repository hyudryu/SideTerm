const MIN_VOICE_SPEED = 0.75;
const MAX_VOICE_SPEED = 1.5;
const DEFAULT_VOICE_SPEED = 1;

function normalizeVoiceSpeed(value, fallback = DEFAULT_VOICE_SPEED) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return normalizeVoiceSpeed(fallback, DEFAULT_VOICE_SPEED);
  const clamped = Math.max(MIN_VOICE_SPEED, Math.min(MAX_VOICE_SPEED, parsed));
  return Math.round(clamped * 20) / 20;
}

module.exports = {
  DEFAULT_VOICE_SPEED,
  MAX_VOICE_SPEED,
  MIN_VOICE_SPEED,
  normalizeVoiceSpeed
};
