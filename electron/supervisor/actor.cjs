class SupervisorActor {
  constructor(options = {}) {
    this.queue = [];
    this.active = null;
    this.sequence = 0;
    this.onStateChange = options.onStateChange || (() => {});
  }

  enqueue(run, options = {}) {
    if (typeof run !== 'function') return Promise.reject(new TypeError('SupervisorActor requires a task function.'));
    const priority = Math.max(0, Math.min(3, Math.floor(Number(options.priority) || 0)));
    return new Promise((resolve, reject) => {
      const item = {
        id: String(options.id || `actor-${++this.sequence}`),
        priority,
        sequence: this.sequence,
        interruptible: Boolean(options.interruptible),
        cancel: typeof options.cancel === 'function' ? options.cancel : null,
        run,
        resolve,
        reject
      };
      this.queue.push(item);
      this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      if (this.active?.interruptible && priority < this.active.priority) this.active.cancel?.();
      this.onStateChange(this.snapshot());
      void this.drain();
    });
  }

  snapshot() {
    return {
      activeId: this.active?.id || null,
      queued: this.queue.map(({ id, priority }) => ({ id, priority }))
    };
  }

  async drain() {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.onStateChange(this.snapshot());
      return;
    }
    this.active = next;
    this.onStateChange(this.snapshot());
    try {
      next.resolve(await next.run());
    } catch (error) {
      next.reject(error);
    } finally {
      this.active = null;
      this.onStateChange(this.snapshot());
      queueMicrotask(() => void this.drain());
    }
  }
}

module.exports = { SupervisorActor };
