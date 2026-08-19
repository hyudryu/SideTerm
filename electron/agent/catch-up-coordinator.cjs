function createCatchUpCoordinator() {
  let owner = null;
  let requestInFlight = false;

  return {
    claim(client) {
      if (owner && owner !== client) return 'owned';
      if (requestInFlight) return 'busy';
      owner = client;
      requestInFlight = true;
      return 'claimed';
    },
    finish(client, { hasMore = false } = {}) {
      if (owner !== client) return false;
      requestInFlight = false;
      if (!hasMore) owner = null;
      return true;
    },
    release(client) {
      if (owner !== client) return false;
      owner = null;
      requestInFlight = false;
      return true;
    },
    isOwner(client) {
      return owner === client;
    }
  };
}

module.exports = { createCatchUpCoordinator };
