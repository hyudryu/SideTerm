function claimConfirmation(state, id) {
  const index = state.confirmations.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('That confirmation is no longer pending.');
  return state.confirmations.splice(index, 1)[0];
}

function restoreConfirmation(state, confirmation) {
  if (!state.confirmations.some((item) => item.id === confirmation.id)) {
    state.confirmations.push(confirmation);
  }
  return state;
}

function createConfirmationExecutionGuard() {
  const inFlight = new Map();
  return (id, execute, decision = '') => {
    const key = String(id || '');
    const wanted = String(decision);
    const existing = inFlight.get(key);
    if (existing) {
      // Identical duplicate decisions share the in-flight execution; an
      // opposite answer must not inherit the other side's outcome.
      if (existing.decision === wanted) return existing.pending;
      return Promise.reject(new Error('That confirmation is already being decided with the opposite answer.'));
    }
    const pending = Promise.resolve().then(execute);
    inFlight.set(key, { decision: wanted, pending });
    void pending.finally(() => {
      if (inFlight.get(key)?.pending === pending) inFlight.delete(key);
    }).catch(() => {});
    return pending;
  };
}

function retirePullRequestConfirmations(state, pullRequestUrl) {
  const retired = state.confirmations.filter((item) => item.kind === 'merge-pull-request'
    && item.pullRequestUrl === pullRequestUrl);
  if (retired.length) {
    const ids = new Set(retired.map((item) => item.id));
    state.confirmations = state.confirmations.filter((item) => !ids.has(item.id));
  }
  return retired;
}

function legacyApprovalInteraction(confirmation) {
  const title = String(confirmation.title || confirmation.sessionId || 'this pending action').slice(0, 300);
  return {
    id: String(confirmation.id),
    sessionId: String(confirmation.sessionId || '').slice(0, 100),
    kind: 'approval',
    prompt: `Approve the pending ${String(confirmation.kind || 'action').replace(/-/g, ' ')} for ${title}?`,
    options: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny' }],
    priority: 0,
    state: 'awaiting_answer',
    createdAt: Number(confirmation.createdAt) || Date.now(),
    answeredAt: 0,
    answer: ''
  };
}

function reconcileConfirmationInteractions(state, { migrateLegacy = false } = {}) {
  const removedIds = new Set();
  let migrated = false;
  if (migrateLegacy) {
    const interactionIds = new Set((state.interactions || []).map((item) => String(item.id)));
    for (const confirmation of state.confirmations || []) {
      if (interactionIds.has(String(confirmation.id))) continue;
      state.interactions.push(legacyApprovalInteraction(confirmation));
      interactionIds.add(String(confirmation.id));
      migrated = true;
    }
  }
  const approvalInteractionIds = new Set((state.interactions || [])
    .filter((item) => item.kind === 'approval')
    .map((item) => String(item.id)));
  state.confirmations = (state.confirmations || []).filter((confirmation) => {
    const paired = approvalInteractionIds.has(String(confirmation.id));
    if (!paired) removedIds.add(String(confirmation.id));
    return paired;
  });
  const confirmationIds = new Set(state.confirmations.map((item) => String(item.id)));
  state.interactions = (state.interactions || []).filter((interaction) => {
    const pendingApproval = interaction.kind === 'approval'
      && ['queued', 'presented', 'awaiting_answer'].includes(interaction.state);
    const paired = !pendingApproval || confirmationIds.has(String(interaction.id));
    if (!paired) removedIds.add(String(interaction.id));
    return paired;
  });
  if (!removedIds.size && !migrated) return removedIds;

  for (const event of state.notifications || []) {
    if (!removedIds.has(String(event.payload?.interactionId || ''))) continue;
    event.state = 'acknowledged';
    event.read = true;
  }
  if (removedIds.has(String(state.activeInteractionId || ''))) state.activeInteractionId = '';
  if (!state.activeInteractionId) {
    const next = state.interactions
      .filter((item) => ['queued', 'presented', 'awaiting_answer'].includes(item.state))
      .sort((left, right) => left.priority - right.priority || left.createdAt - right.createdAt)[0];
    state.activeInteractionId = next?.id || '';
    if (next?.state === 'queued') next.state = 'presented';
  }
  return removedIds;
}

module.exports = { claimConfirmation, createConfirmationExecutionGuard, legacyApprovalInteraction, reconcileConfirmationInteractions, restoreConfirmation, retirePullRequestConfirmations };
