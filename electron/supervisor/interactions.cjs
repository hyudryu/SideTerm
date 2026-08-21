const crypto = require('node:crypto');

function normalizePendingInteraction(value = {}, options = {}) {
  const states = new Set(['queued', 'presented', 'awaiting_answer', 'answered', 'cancelled']);
  const kinds = new Set(['coding_question', 'tui_selection', 'approval', 'supervisor_question']);
  return {
    id: String(value.id || options.createId?.() || crypto.randomUUID()),
    sessionId: String(value.sessionId || '').slice(0, 100),
    kind: kinds.has(value.kind) ? value.kind : 'supervisor_question',
    prompt: String(value.prompt || '').slice(0, 2000),
    options: Array.isArray(value.options) ? value.options.slice(0, 20).map((item) => ({
      id: String(item?.id || '').slice(0, 100),
      label: String(item?.label || '').slice(0, 300)
    })).filter((item) => item.id && item.label) : [],
    priority: Math.max(0, Math.min(3, Math.floor(Number(value.priority) || 0))),
    state: states.has(value.state) ? value.state : 'queued',
    createdAt: Number(value.createdAt) || (options.now?.() ?? Date.now()),
    answeredAt: Number(value.answeredAt) || 0,
    answer: String(value.answer || '').slice(0, 20_000)
  };
}

function interpretApprovalAnswer(value) {
  const text = String(value || '').trim();
  if (/^(?:yes|yeah|yep|approve|approved|do it|go ahead|okay|ok)$/i.test(text)) return true;
  if (/^(?:no|nope|deny|denied|cancel|don.t|do not)$/i.test(text)) return false;
  return null;
}

class PendingInteractionManager {
  constructor(interactions = [], options = {}) {
    this.interactions = interactions;
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => crypto.randomUUID());
    this.onChange = options.onChange || (() => {});
    this.activeInteractionId = String(options.activeInteractionId || '');
  }

  create(value) {
    const interaction = normalizePendingInteraction(value, { now: this.now, createId: this.createId });
    this.interactions.push(interaction);
    this.activateNext();
    this.onChange(this.snapshot());
    return interaction;
  }

  activateNext() {
    const active = this.interactions.find((item) => item.id === this.activeInteractionId
      && ['presented', 'awaiting_answer'].includes(item.state));
    if (active) return active;
    const next = this.interactions
      .filter((item) => ['queued', 'presented', 'awaiting_answer'].includes(item.state))
      .sort((left, right) => left.priority - right.priority || left.createdAt - right.createdAt)[0];
    this.activeInteractionId = next?.id || '';
    if (next?.state === 'queued') next.state = 'presented';
    return next || null;
  }

  answer(text, interactionId = '') {
    const id = String(interactionId || this.activeInteractionId);
    const interaction = this.interactions.find((item) => item.id === id);
    if (!interaction || !['presented', 'awaiting_answer'].includes(interaction.state)) return null;
    interaction.state = 'answered';
    interaction.answer = String(text || '').slice(0, 20_000);
    interaction.answeredAt = this.now();
    if (this.activeInteractionId === id) this.activeInteractionId = '';
    this.activateNext();
    this.onChange(this.snapshot());
    return interaction;
  }

  cancel(id) {
    const interaction = this.interactions.find((item) => item.id === String(id));
    if (!interaction) return false;
    interaction.state = 'cancelled';
    if (this.activeInteractionId === interaction.id) this.activeInteractionId = '';
    this.activateNext();
    this.onChange(this.snapshot());
    return true;
  }

  snapshot() {
    return { interactions: this.interactions, activeInteractionId: this.activeInteractionId };
  }
}

module.exports = { interpretApprovalAnswer, PendingInteractionManager, normalizePendingInteraction };
