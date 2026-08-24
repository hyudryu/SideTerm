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

function isCodexReviewHandoff(confirmation) {
  return confirmation?.source === 'codex-review-handoff'
    || (confirmation?.kind === 'terminal-input'
      && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/i.test(String(confirmation?.pullRequestUrl || ''))
      && /^Please inspect the latest Codex review comments on https:\/\/github\.com\//i.test(String(confirmation?.input || '')));
}

function compactCodexReviewHandoffs(state) {
  const newestByPullRequest = new Map();
  for (const confirmation of state.confirmations || []) {
    if (!isCodexReviewHandoff(confirmation)) continue;
    confirmation.source = 'codex-review-handoff';
    confirmation.handoffKey = `codex-review-handoff:${confirmation.pullRequestUrl}`;
    const existing = newestByPullRequest.get(confirmation.pullRequestUrl);
    if (!existing || Number(confirmation.createdAt) >= Number(existing.createdAt)) {
      newestByPullRequest.set(confirmation.pullRequestUrl, confirmation);
    }
  }
  const retainedIds = new Set([...newestByPullRequest.values()].map((item) => String(item.id)));
  for (const confirmation of newestByPullRequest.values()) {
    const pull = (state.pullRequests || []).find((item) => item.url === confirmation.pullRequestUrl);
    if (!pull) continue;
    confirmation.headSha = String(pull.headSha || confirmation.headSha || '');
    pull.codexReviewPromptedHeadSha = confirmation.headSha;
  }
  const removedIds = new Set((state.confirmations || [])
    .filter((item) => isCodexReviewHandoff(item) && !retainedIds.has(String(item.id)))
    .map((item) => String(item.id)));
  if (!removedIds.size) return removedIds;
  state.confirmations = state.confirmations.filter((item) => !removedIds.has(String(item.id)));
  state.interactions = (state.interactions || []).filter((item) => !removedIds.has(String(item.id)));
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

module.exports = {
  claimConfirmation,
  compactCodexReviewHandoffs,
  isCodexReviewHandoff,
  legacyApprovalInteraction,
  reconcileConfirmationInteractions,
  restoreConfirmation,
  retirePullRequestConfirmations
};
