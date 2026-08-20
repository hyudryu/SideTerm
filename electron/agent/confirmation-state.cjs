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

module.exports = { claimConfirmation, restoreConfirmation };
