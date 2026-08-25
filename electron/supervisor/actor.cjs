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
    const sequence = ++this.sequence;
    return new Promise((resolve, reject) => {
      const item = {
        id: String(options.id || `actor-${sequence}`),
        priority,
        sequence,
        interruptible: Boolean(options.interruptible),
        cancel: typeof options.cancel === 'function' ? options.cancel : null,
        cancelled: false,
        run,
        resolve,
        reject
      };
      this.queue.push(item);
      this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      if (this.active?.interruptible && priority < this.active.priority) {
        this.active.cancelled = true;
        this.active.cancel?.();
      }
      this.onStateChange(this.snapshot());
      void this.drain();
    });
  }

  cancel(id) {
    const taskId = String(id || '');
    if (!taskId) return false;
    const queuedIndex = this.queue.findIndex((item) => item.id === taskId);
    if (queuedIndex >= 0) {
      const [item] = this.queue.splice(queuedIndex, 1);
      item.cancelled = true;
      item.reject(Object.assign(new Error('Supervisor task was cancelled.'), { name: 'AbortError' }));
      this.onStateChange(this.snapshot());
      return true;
    }
    if (this.active?.id !== taskId) return false;
    this.active.cancelled = true;
    this.active.cancel?.();
    return true;
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
      const result = await next.run({ isCancelled: () => next.cancelled });
      if (next.cancelled) next.reject(Object.assign(new Error('Supervisor task was cancelled.'), { name: 'AbortError' }));
      else next.resolve(result);
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
