const crypto = require('node:crypto');

function normalizeWatch(value = {}, options = {}) {
  return {
    id: String(value.id || options.createId?.() || crypto.randomUUID()),
    kind: String(value.kind || 'generic').slice(0, 100),
    repo: String(value.repo || '').slice(0, 300),
    prNumber: Math.max(0, Number(value.prNumber) || 0),
    intervalSeconds: Math.max(60, Math.floor(Number(value.intervalSeconds) || 60)),
    state: ['active', 'condition_met', 'paused', 'terminal'].includes(value.state) ? value.state : 'active',
    exitCondition: String(value.exitCondition || '').slice(0, 100),
    lastFingerprint: String(value.lastFingerprint || '').slice(0, 500),
    headSha: String(value.headSha || '').slice(0, 100),
    lastCheckedAt: Number(value.lastCheckedAt) || 0,
    cancelledAt: Number(value.cancelledAt) || 0,
    createdAt: Number(value.createdAt) || (options.now?.() ?? Date.now()),
    updatedAt: Number(value.updatedAt) || (options.now?.() ?? Date.now())
  };
}

class WatchManager {
  constructor(watches = [], options = {}) {
    this.watches = watches;
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => crypto.randomUUID());
    this.onChange = options.onChange || (() => {});
  }

  create(value) {
    const watch = normalizeWatch(value, { now: this.now, createId: this.createId });
    const existing = this.watches.find((item) => item.kind === watch.kind && item.repo === watch.repo && item.prNumber === watch.prNumber && item.state === 'active');
    if (existing) return existing;
    this.watches.push(watch);
    this.onChange(this.watches);
    return watch;
  }

  conditionMet(id, fingerprint, headSha = '') {
    const watch = this.watches.find((item) => item.id === String(id));
    if (!watch) return null;
    watch.state = 'terminal';
    watch.lastFingerprint = String(fingerprint || '').slice(0, 500);
    watch.headSha = String(headSha || watch.headSha || '').slice(0, 100);
    watch.updatedAt = this.now();
    this.onChange(this.watches);
    return watch;
  }

  rearm(id, headSha) {
    const watch = this.watches.find((item) => item.id === String(id));
    if (!watch) return null;
    if (watch.headSha === String(headSha || '')) return watch;
    watch.state = 'active';
    watch.cancelledAt = 0;
    watch.headSha = String(headSha || '').slice(0, 100);
    watch.lastFingerprint = '';
    watch.updatedAt = this.now();
    this.onChange(this.watches);
    return watch;
  }

  activate(id, { headSha = '', intervalSeconds = 60 } = {}) {
    const watch = this.watches.find((item) => item.id === String(id));
    if (!watch) return null;
    watch.state = 'active';
    watch.cancelledAt = 0;
    watch.headSha = String(headSha || watch.headSha || '').slice(0, 100);
    watch.intervalSeconds = Math.max(60, Math.floor(Number(intervalSeconds) || 60));
    watch.lastFingerprint = '';
    watch.updatedAt = this.now();
    this.onChange(this.watches);
    return watch;
  }

  markChecked(id, checkedAt = this.now()) {
    const watch = this.watches.find((item) => item.id === String(id));
    if (!watch) return null;
    watch.lastCheckedAt = Number(checkedAt) || this.now();
    watch.updatedAt = this.now();
    this.onChange(this.watches);
    return watch;
  }

  cancel(id) {
    const watch = this.watches.find((item) => item.id === String(id));
    if (!watch) return false;
    watch.state = 'terminal';
    watch.cancelledAt = this.now();
    watch.updatedAt = this.now();
    this.onChange(this.watches);
    return true;
  }

  active() { return this.watches.filter((item) => item.state === 'active'); }
}

function watchIsDue(watch, now = Date.now()) {
  if (watch?.state !== 'active') return false;
  return Number(now) - (Number(watch.lastCheckedAt) || 0) >= Math.max(60, Number(watch.intervalSeconds) || 60) * 1000;
}

module.exports = { WatchManager, normalizeWatch, watchIsDue };
