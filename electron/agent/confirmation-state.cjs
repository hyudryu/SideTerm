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

function retirePullRequestConfirmations(state, pullRequestUrl) {
  const retired = state.confirmations.filter((item) => item.kind === 'merge-pull-request'
    && item.pullRequestUrl === pullRequestUrl);
  if (retired.length) {
    const ids = new Set(retired.map((item) => item.id));
    state.confirmations = state.confirmations.filter((item) => !ids.has(item.id));
  }
  return retired;
}

function reconcileConfirmationInteractions(state) {
  const removedIds = new Set();
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
  if (!removedIds.size) return removedIds;

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

module.exports = { claimConfirmation, reconcileConfirmationInteractions, restoreConfirmation, retirePullRequestConfirmations };
