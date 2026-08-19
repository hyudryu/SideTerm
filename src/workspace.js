export const WORKSPACE_VERSION = 1;
export const DEFAULT_GROUP_COLOR = '#60cdff';

export function normalizeGroupColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : DEFAULT_GROUP_COLOR;
}

export function createGroup(id, title, collapsed = false, color = DEFAULT_GROUP_COLOR) {
  return { id, title, collapsed, color: normalizeGroupColor(color), sessionIds: [] };
}

export function reorderGroup(groups, sourceId, targetId, position) {
  if (sourceId === targetId || !['before', 'after'].includes(position)) return groups;
  const source = groups.find((group) => group.id === sourceId);
  if (!source || !groups.some((group) => group.id === targetId)) return groups;

  const reordered = groups.filter((group) => group.id !== sourceId);
  const targetIndex = reordered.findIndex((group) => group.id === targetId);
  reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);
  return reordered;
}

export function moveSession(groups, sessionId, targetGroupId, beforeSessionId = null) {
  if (!groups.some((group) => group.id === targetGroupId)) return groups;

  const moved = groups.map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter((id) => id !== sessionId)
  }));
  const target = moved.find((group) => group.id === targetGroupId);
  const beforeIndex = beforeSessionId ? target.sessionIds.indexOf(beforeSessionId) : -1;
  target.sessionIds.splice(beforeIndex >= 0 ? beforeIndex : target.sessionIds.length, 0, sessionId);
  return moved;
}

export function removeSessionFromGroups(groups, sessionId) {
  return groups.map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter((id) => id !== sessionId)
  }));
}

export function parseSavedWorkspace(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== WORKSPACE_VERSION || !Array.isArray(value.groups) || !Array.isArray(value.sessions)) {
      return null;
    }

    const sessions = value.sessions
      .filter((session) => session && typeof session.id === 'string' && typeof session.groupId === 'string')
      .map((session) => ({
        id: session.id,
        groupId: session.groupId,
        title: typeof session.title === 'string' ? session.title : 'Terminal',
        manualTitle: Boolean(session.manualTitle),
        shell: typeof session.shell === 'string' ? session.shell : 'shell',
        cwd: typeof session.cwd === 'string' ? session.cwd : '',
        history: typeof session.history === 'string' ? session.history : '',
        notified: Boolean(session.notified),
        activityArmed: Boolean(session.activityArmed),
        displayName: typeof session.displayName === 'string' ? session.displayName : '',
        summary: typeof session.summary === 'string' ? session.summary : '',
        agent: typeof session.agent === 'string' ? session.agent : '',
        hasUserActivity: Boolean(session.hasUserActivity),
        aiInitialSummaryDone: Boolean(session.aiInitialSummaryDone),
        lastAiSummaryAt: Number.isFinite(session.lastAiSummaryAt) && session.lastAiSummaryAt > 0 ? session.lastAiSummaryAt : 0,
        links: Array.isArray(session.links)
          ? session.links
            .filter((link) => link && typeof link.url === 'string' && /^https?:\/\//.test(link.url))
            .slice(-100)
          : []
      }));
    const validSessionIds = new Set(sessions.map((session) => session.id));
    const seenGroupIds = new Set();
    const groups = value.groups
      .filter((group) => group && typeof group.id === 'string' && !seenGroupIds.has(group.id))
      .map((group) => {
        seenGroupIds.add(group.id);
        return {
          id: group.id,
          title: typeof group.title === 'string' && group.title.trim() ? group.title.trim() : 'Group',
          color: normalizeGroupColor(group.color),
          collapsed: Boolean(group.collapsed),
          sessionIds: Array.isArray(group.sessionIds)
            ? [...new Set(group.sessionIds.filter((id) => validSessionIds.has(id)))]
            : []
        };
      });

    if (groups.length === 0) return null;
    const assigned = new Set(groups.flatMap((group) => group.sessionIds));
    for (const session of sessions) {
      if (assigned.has(session.id)) continue;
      const requested = groups.find((group) => group.id === session.groupId) || groups[0];
      requested.sessionIds.push(session.id);
    }

    return {
      groups,
      sessions,
      activeId: typeof value.activeId === 'string' ? value.activeId : null,
      activeGroupId: groups.some((group) => group.id === value.activeGroupId)
        ? value.activeGroupId
        : groups[0].id
    };
  } catch {
    return null;
  }
}
