const SEMANTIC_STATES = new Set(['working', 'completed', 'input_required', 'blocked', 'failed']);
const SESSION_STATUSES = new Set(['running', 'idle', 'stopped']);

function normalizeSessionRecord(value = {}, previous = {}) {
  return {
    id: String(value.id || previous.id || '').slice(0, 100),
    backend: value.backend === 'deepseek-harness' ? 'deepseek-harness' : 'sideterm-pty',
    friendlyName: String(value.friendlyName || value.title || previous.friendlyName || 'Terminal').slice(0, 100),
    customName: String(value.customName || previous.customName || '').slice(0, 100),
    cwd: String(value.cwd || previous.cwd || '').slice(0, 4096),
    repo: value.repo?.owner && value.repo?.name
      ? { owner: String(value.repo.owner).slice(0, 100), name: String(value.repo.name).slice(0, 100) }
      : previous.repo,
    branch: String(value.branch || previous.branch || '').slice(0, 300),
    prNumber: Math.max(0, Number(value.prNumber || previous.prNumber) || 0),
    status: SESSION_STATUSES.has(value.status) ? value.status : previous.status || 'idle',
    semanticState: SEMANTIC_STATES.has(value.semanticState) ? value.semanticState : previous.semanticState,
    currentTask: String(value.currentTask || previous.currentTask || '').slice(0, 1000),
    lastActivityAt: Number(value.lastActivityAt) || previous.lastActivityAt || Date.now(),
    revision: Math.max((Number(previous.revision) || 0) + 1, Number(value.revision) || 1)
  };
}

class SessionIndex {
  constructor(records = [], options = {}) {
    this.records = new Map(records.map((record) => [record.id, normalizeSessionRecord(record)]));
    this.onChange = options.onChange || (() => {});
  }

  upsert(value) {
    if (!value?.id) throw new Error('Session records require an id.');
    const record = normalizeSessionRecord(value, this.records.get(String(value.id)));
    this.records.set(record.id, record);
    this.onChange(this.list());
    return record;
  }

  remove(id) {
    const removed = this.records.delete(String(id));
    if (removed) this.onChange(this.list());
    return removed;
  }

  get(id) {
    return this.records.get(String(id)) || null;
  }

  list() {
    return [...this.records.values()].sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  }
}

module.exports = { SessionIndex, normalizeSessionRecord };
