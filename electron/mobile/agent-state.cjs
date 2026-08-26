function text(value, maxLength) {
  return String(value || '').slice(0, maxLength);
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
    confirmations: (Array.isArray(state.confirmations) ? state.confirmations : []).slice(-20).map((confirmation) => ({
      id: text(confirmation?.id, 100),
      kind: text(confirmation?.kind, 60),
      title: text(confirmation?.title, 200),
      summary: text(confirmation?.summary, 2_000),
      pullRequestUrl: text(confirmation?.pullRequestUrl, 500),
      body: text(confirmation?.body, 12_000),
      optionLabel: text(confirmation?.optionLabel, 500),
      input: text(confirmation?.input, 12_000)
    }))
  };
}

module.exports = { mobileAgentState };
