function pendingNotifications(notifications = []) {
  const latestBySession = new Map();
  for (const item of notifications) {
    if (!item || item.read || !item.sessionId) continue;
    const previous = latestBySession.get(item.sessionId);
    if (!previous || Number(item.createdAt || 0) >= Number(previous.createdAt || 0)) {
      latestBySession.set(item.sessionId, item);
    }
  }
  return notifications
    .filter((item) => item && !item.read)
    .filter((item) => !item.sessionId || latestBySession.get(item.sessionId) === item)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timeDifference = Number(right.item.createdAt || 0) - Number(left.item.createdAt || 0);
      return timeDifference || left.index - right.index;
    })
    .map(({ item }) => item);
}

function markSupersededNotificationsRead(notifications = []) {
  const pending = new Set(pendingNotifications(notifications));
  for (const item of notifications) {
    if (item?.sessionId && !item.read && !pending.has(item)) item.read = true;
  }
  return notifications;
}

function nextCatchUp(notifications = []) {
  const pending = pendingNotifications(notifications);
  return {
    notification: pending[0] || null,
    remainingCount: Math.max(0, pending.length - 1)
  };
}

function catchUpPrompt(notification, remainingCount = 0) {
  if (!notification) return '';
  const queueInstruction = remainingCount > 0
    ? `There are ${remainingCount} other pending updates. Do not summarize or mention their details yet, and do not ask a next-step question.`
    : 'This is the final pending update, so you may briefly ask what the user wants to do next.';
  return [
    'Give a concise, colloquial spoken summary for exactly this one pending update.',
    'Only report a meaningful completed outcome, a failure or blocker, or a concrete request that needs the user\'s input.',
    'Routine investigation, planning progress, repository inspection, and intermediate status are not updates.',
    'If the latest evidence does not establish something worth interrupting the user for, reply with exactly NO_UPDATE.',
    'Use one or two plain-text sentences, no Markdown, and no more than 35 words.',
    queueInstruction
  ].join(' ');
}

function isNoUpdateResponse(value) {
  return String(value || '').trim().replace(/[.!]+$/, '').toUpperCase() === 'NO_UPDATE';
}

function automaticPresenterSentinel(value) {
  const normalized = String(value || '').trim().replace(/[.!]+$/, '').toUpperCase();
  return normalized === 'NO_UPDATE' || normalized === 'NEEDS_ENRICHMENT' ? normalized : '';
}

function isAutomaticPresenterSentinel(value) {
  return Boolean(automaticPresenterSentinel(value));
}

function shouldScheduleWorkspaceCatchUp({ addedCount = 0, unreadCount = 0, initialized = false } = {}) {
  return addedCount > 0 || (!initialized && unreadCount > 0);
}

module.exports = { automaticPresenterSentinel, catchUpPrompt, isAutomaticPresenterSentinel, isNoUpdateResponse, markSupersededNotificationsRead, nextCatchUp, pendingNotifications, shouldScheduleWorkspaceCatchUp };
