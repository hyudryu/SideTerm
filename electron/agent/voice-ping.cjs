const VOICE_PING_BACKOFF_MS = [5 * 60_000, 10 * 60_000, 15 * 60_000];
const VOICE_PING_PHRASES = ['Hey, you there?', 'Hey, got a minute?', 'You around?', 'Hey, still there?'];

// Announces pending updates in voice mode with a casual presence check instead
// of a full report. Re-asks after 5, 10, then 15 minutes and gives up after
// that; any user response cancels the cycle because a live chat delivers the
// pending update through normal evidence injection.
class VoicePingScheduler {
  constructor({
    speak,
    hasUnread,
    backoffMs = VOICE_PING_BACKOFF_MS,
    phrases = VOICE_PING_PHRASES,
    now = () => Date.now(),
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (timer) => clearTimeout(timer)
  } = {}) {
    if (typeof speak !== 'function' || typeof hasUnread !== 'function') {
      throw new Error('VoicePingScheduler requires speak and hasUnread callbacks.');
    }
    this.speak = speak;
    this.hasUnread = hasUnread;
    this.backoffMs = backoffMs;
    this.phrases = phrases.length ? phrases : VOICE_PING_PHRASES;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.attempt = 0;
    this.spoken = 0;
  }

  get active() {
    return this.timer !== null;
  }

  start() {
    if (this.active) return;
    this.attempt = 0;
    this.speakPhrase();
    this.scheduleNext();
  }

  speakPhrase() {
    this.speak(this.phrases[this.spoken % this.phrases.length]);
    this.spoken += 1;
  }

  scheduleNext() {
    const delayMs = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)];
    this.timer = this.setTimer(() => this.fire(), delayMs);
  }

  fire() {
    this.timer = null;
    if (!this.hasUnread()) {
      this.reset();
      return;
    }
    if (this.attempt >= this.backoffMs.length) return;
    this.attempt += 1;
    this.speakPhrase();
    this.scheduleNext();
  }

  reset() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.attempt = 0;
  }
}

module.exports = { VoicePingScheduler, VOICE_PING_BACKOFF_MS, VOICE_PING_PHRASES };
