const crypto = require('node:crypto');

const EVENT_PRIORITIES = Object.freeze({
  INPUT_REQUIRED: 0,
  BLOCKED: 0,
  FAILED: 0,
  DESTRUCTIVE_APPROVAL_REQUIRED: 0,
  REVIEW_RECEIVED: 1,
  CI_FAILED: 1,
  WATCH_CONDITION_MET: 1,
  COMPLETED: 2,
  CI_PASSED: 3,
  INFO: 3
});

const EVENT_KINDS = new Set(Object.keys(EVENT_PRIORITIES));

function eventKind(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return EVENT_KINDS.has(normalized) ? normalized : 'INFO';
}

function eventPriority(kind, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 3) return number;
  return EVENT_PRIORITIES[eventKind(kind)];
}

function normalizeSupervisorEvent(value = {}, options = {}) {
  const kind = eventKind(value.kind);
  const sessionId = String(value.sessionId || '').slice(0, 100);
  const createdAt = Number(value.createdAt) || (options.now?.() ?? Date.now());
  const cycleId = String(value.cycleId || '').slice(0, 240);
  const dedupeKey = String(value.dedupeKey || cycleId || `${kind}:${sessionId}:${createdAt}`).slice(0, 500);
  return {
    id: String(value.id || options.createId?.() || crypto.randomUUID()),
    cycleId,
    kind,
    priority: eventPriority(kind, value.priority),
    sessionId,
    friendlyName: String(value.friendlyName || value.title || 'SideTerm').slice(0, 100),
    title: String(value.title || value.friendlyName || 'SideTerm').slice(0, 100),
    summary: String(value.summary || '').slice(0, 1000),
    context: String(value.context || '').slice(-12_000),
    cwd: String(value.cwd || '').slice(0, 4096),
    links: Array.isArray(value.links) ? value.links.filter((item) => /^https?:\/\//.test(item)).slice(-20) : [],
    dedupeKey,
    presentation: {
      shortText: String(value.presentation?.shortText || '').slice(0, 1000),
      requiresUserReply: Boolean(value.presentation?.requiresUserReply),
      suggestedAction: String(value.presentation?.suggestedAction || '').slice(0, 300)
    },
    payload: value.payload && typeof value.payload === 'object' ? value.payload : {},
    createdAt,
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    state: ['queued', 'presented', 'reasoned', 'acknowledged', 'superseded'].includes(value.state)
      ? value.state
      : value.read ? 'acknowledged' : 'queued',
    read: Boolean(value.read)
  };
}

function compareEvents(left, right) {
  return left.priority - right.priority || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

class PriorityEventBus {
  constructor(events = [], options = {}) {
    this.events = events;
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => crypto.randomUUID());
    this.onChange = options.onChange || (() => {});
  }

  enqueue(value) {
    const event = normalizeSupervisorEvent(value, { now: this.now, createId: this.createId });
    const duplicate = this.events.find((item) => item.dedupeKey === event.dedupeKey && item.state !== 'superseded');
    if (duplicate) return { event: duplicate, added: false };

    if (event.sessionId) {
      for (const pending of this.events) {
        if (pending.sessionId === event.sessionId && pending.state === 'queued' && pending.kind === event.kind) {
          pending.state = 'superseded';
          pending.read = true;
        }
      }
    }
    this.events.push(event);
    if (this.events.length > 240) this.events.splice(0, this.events.length - 240);
    this.onChange(this.events);
    return { event, added: true };
  }

  pending() {
    return this.events.filter((item) => !item.read && item.state === 'queued').sort(compareEvents);
  }

  next(activeInteractionId = null) {
    const pending = this.pending();
    if (activeInteractionId === null) return pending[0] || null;
    const activeId = String(activeInteractionId || '');
    return pending.find((event) => {
      const interactionId = String(event.payload?.interactionId || '');
      return !interactionId || interactionId === activeId;
    }) || null;
  }

  transition(id, state) {
    const event = this.events.find((item) => item.id === id);
    if (!event) return null;
    event.state = state;
    if (['acknowledged', 'superseded'].includes(state)) event.read = true;
    this.onChange(this.events);
    return event;
  }

  transitionForInteraction(interactionId, state) {
    const id = String(interactionId || '');
    if (!id) return 0;
    let changed = 0;
    for (const event of this.events) {
      if (String(event.payload?.interactionId || '') !== id) continue;
      event.state = state;
      if (['acknowledged', 'superseded'].includes(state)) event.read = true;
      changed += 1;
    }
    if (changed) this.onChange(this.events);
    return changed;
  }
}

module.exports = {
  EVENT_PRIORITIES,
  PriorityEventBus,
  compareEvents,
  eventKind,
  eventPriority,
  normalizeSupervisorEvent
};
