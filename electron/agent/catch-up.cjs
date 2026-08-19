function pendingNotifications(notifications = []) {
  return notifications
    .filter((item) => item && !item.read)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timeDifference = Number(left.item.createdAt || 0) - Number(right.item.createdAt || 0);
      return timeDifference || left.index - right.index;
    })
    .map(({ item }) => item);
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
    'Give a concise, colloquial spoken update for exactly this one finished task.',
    'Use one or two plain-text sentences, no Markdown, and no more than 35 words.',
    queueInstruction
  ].join(' ');
}

module.exports = { catchUpPrompt, nextCatchUp, pendingNotifications };
