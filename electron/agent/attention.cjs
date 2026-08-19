const crypto = require('node:crypto');

function attentionCycleId(session) {
  const explicit = String(session?.attentionCycleId || '').slice(0, 200);
  return explicit || `restored:${String(session?.id || '').slice(0, 100)}`;
}

function reconcileAttentionNotifications(state, workspace, options = {}) {
  const now = options.now || (() => Date.now());
  const createId = options.createId || (() => crypto.randomUUID());
  const contextForSession = options.contextForSession || (() => '');
  const notifications = Array.isArray(state.notifications) ? state.notifications : (state.notifications = []);
  const existing = new Set(notifications.map((item) => `${item.sessionId}:${item.cycleId}`));
  const added = [];

  for (const session of workspace.sessions || []) {
    if (!session?.id || !session.notified) continue;
    const cycleId = attentionCycleId(session);
    const key = `${session.id}:${cycleId}`;
    if (existing.has(key)) continue;
    const notification = {
      id: createId(),
      cycleId,
      sessionId: String(session.id).slice(0, 100),
      title: String(session.title || 'Terminal').slice(0, 100),
      summary: String(session.summary || 'This background session finished and needs review.').slice(0, 500),
      context: String(contextForSession(session.id) || '').slice(-12_000),
      cwd: String(session.cwd || '').slice(0, 4096),
      links: Array.isArray(session.links) ? session.links.filter((item) => /^https?:\/\//.test(item)).slice(-20) : [],
      createdAt: now(),
      read: false
    };
    notifications.push(notification);
    existing.add(key);
    added.push(notification);
  }

  if (notifications.length > 240) notifications.splice(0, notifications.length - 240);
  return added;
}

module.exports = { attentionCycleId, reconcileAttentionNotifications };
