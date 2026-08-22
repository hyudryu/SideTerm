const DEFAULT_PROACTIVE_DELAY_MS = 0;
const DEFAULT_PROACTIVE_RETRY_MS = 20_000;
const DEFAULT_PROACTIVE_MIN_INTERVAL_MS = 0;
const DEFAULT_PROACTIVE_MAX_ATTEMPTS = 3;

// Batches newly finished work into background supervisor check-ins. The run
// callback reports 'ran', 'busy', 'skipped', or 'failed'; only 'busy' and
// bounded 'failed' outcomes retry, so a dead provider cannot loop forever.
class ProactiveCatchUpScheduler {
  constructor({
    run,
    delayMs = DEFAULT_PROACTIVE_DELAY_MS,
    retryDelayMs = DEFAULT_PROACTIVE_RETRY_MS,
    minIntervalMs = DEFAULT_PROACTIVE_MIN_INTERVAL_MS,
    maxAttempts = DEFAULT_PROACTIVE_MAX_ATTEMPTS,
    now = () => Date.now(),
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (timer) => clearTimeout(timer)
  } = {}) {
    if (typeof run !== 'function') throw new Error('ProactiveCatchUpScheduler requires a run callback.');
    this.run = run;
    this.delayMs = delayMs;
    this.retryDelayMs = retryDelayMs;
    this.minIntervalMs = minIntervalMs;
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.scheduledAt = 0;
    this.pending = false;
    this.attempts = 0;
    this.lastRanAt = 0;
  }

  notify({ delayMs = this.delayMs } = {}) {
    this.pending = true;
    this.attempts = 0;
    const requestedAt = this.now() + Math.max(0, Number(delayMs) || 0);
    if (this.timer && requestedAt >= this.scheduledAt) return;
    if (this.timer) this.clearTimer(this.timer);
    this.schedule(Math.max(0, requestedAt - this.now()));
  }

  schedule(delayMs) {
    this.scheduledAt = this.now() + delayMs;
    this.timer = this.setTimer(() => this.fire(), delayMs);
  }

  async fire() {
    this.timer = null;
    this.scheduledAt = 0;
    if (!this.pending) return;
    const sinceLastRun = this.lastRanAt ? this.now() - this.lastRanAt : Infinity;
    if (sinceLastRun < this.minIntervalMs) {
      this.schedule(this.minIntervalMs - sinceLastRun);
      return;
    }
    this.pending = false;
    this.attempts += 1;
    let outcome = 'failed';
    try {
      outcome = await this.run();
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'ran') {
      this.lastRanAt = this.now();
      return;
    }
    if (outcome === 'busy' || (outcome === 'failed' && this.attempts < this.maxAttempts)) {
      this.pending = true;
      this.schedule(this.retryDelayMs);
    }
  }

  cancel() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.scheduledAt = 0;
    this.pending = false;
    this.attempts = 0;
  }
}

module.exports = {
  ProactiveCatchUpScheduler,
  DEFAULT_PROACTIVE_DELAY_MS,
  DEFAULT_PROACTIVE_MIN_INTERVAL_MS
};
