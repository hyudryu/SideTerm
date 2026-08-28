function text(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

// Terminal inputs and comment bodies execute server-side at their full
// length, so mobile has to receive the complete actionable content or refuse
// to approve it. 65,536 matches the terminal input cap on the socket handler.
const ACTIONABLE_CONTENT_LIMIT = 65_536;

function actionableText(value) {
  const raw = String(value || '');
  return { value: raw.slice(0, ACTIONABLE_CONTENT_LIMIT), truncated: raw.length > ACTIONABLE_CONTENT_LIMIT };
}

function mobileAgentState(state = {}) {
  const notifications = Array.isArray(state.notifications) ? state.notifications : [];
  return {
    enabled: Boolean(state.enabled),
    status: text(state.status, 40) || 'idle',
    messages: (Array.isArray(state.messages) ? state.messages : []).slice(-40).map((message) => ({
      role: text(message?.role, 20),
      text: text(message?.text, 6_000)
    })),
    notifications: notifications.slice(-8).map((notification) => ({
      id: text(notification?.id, 100),
      read: Boolean(notification?.read),
      title: text(notification?.title, 200),
      summary: text(notification?.summary, 1_000)
    })),
    unreadNotificationCount: notifications.reduce((count, notification) => count + Number(!notification?.read), 0),
    // Keep every pending confirmation reachable: the server retains up to 120
    // and mobile has no pagination, so slicing fewer would hide pending actions.
    confirmations: (Array.isArray(state.confirmations) ? state.confirmations : []).slice(-120).map((confirmation) => {
      const body = actionableText(confirmation?.body);
      const input = actionableText(confirmation?.input);
      return {
        id: text(confirmation?.id, 100),
        kind: text(confirmation?.kind, 60),
        title: text(confirmation?.title, 200),
        summary: text(confirmation?.summary, 2_000),
        pullRequestUrl: text(confirmation?.pullRequestUrl, 500),
        body: body.value,
        optionLabel: text(confirmation?.optionLabel, 500),
        input: input.value,
        truncated: body.truncated || input.truncated
      };
    })
  };
}

module.exports = { mobileAgentState };
