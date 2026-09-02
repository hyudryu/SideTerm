import { normalizeGithubPullRequestUrl } from './activity.js';

export const WORKSPACE_VERSION = 1;
export const DEFAULT_GROUP_COLOR = '#60cdff';
export const GROUP_SORTS = ['default', 'created', 'response', 'name'];

export async function persistWorkspaceCopies(serializedWorkspace, {
  saveBrowser,
  saveBackup,
  required = false,
  onTotalFailure = () => {}
}) {
  let browserSaved = false;
  try {
    saveBrowser(serializedWorkspace);
    browserSaved = true;
  } catch {
    // The native file remains an independent durable copy.
  }
  try {
    await saveBackup(serializedWorkspace);
    return true;
  } catch (error) {
    if (browserSaved) return true;
    onTotalFailure(error);
    if (required) throw error;
    return false;
  }
}

export function normalizeGroupSort(value) {
  return GROUP_SORTS.includes(value) ? value : 'default';
}

export function normalizeSortDirection(value) {
  return value === 'desc' ? 'desc' : 'asc';
}

export function normalizeGroupColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : DEFAULT_GROUP_COLOR;
}

export function createGroup(id, title, collapsed = false, color = DEFAULT_GROUP_COLOR) {
  return {
    id,
    title,
    collapsed,
    color: normalizeGroupColor(color),
    sortBy: 'default',
    sortDirection: 'asc',
    sessionIds: []
  };
}

export function sortedSessionIds(group, sessionLookup) {
  const ids = group.sessionIds.filter((id) => sessionLookup.has(id));
  const sortBy = normalizeGroupSort(group.sortBy);
  const direction = normalizeSortDirection(group.sortDirection) === 'desc' ? -1 : 1;
  if (sortBy === 'default') return direction === 1 ? ids : [...ids].reverse();

  const manualOrder = new Map(ids.map((id, index) => [id, index]));
  return [...ids].sort((leftId, rightId) => {
    const left = sessionLookup.get(leftId) || {};
    const right = sessionLookup.get(rightId) || {};
    let comparison = 0;
    if (sortBy === 'created') comparison = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0);
    if (sortBy === 'response') comparison = (Number(left.lastResponseAt) || 0) - (Number(right.lastResponseAt) || 0);
    if (sortBy === 'name') {
      const leftName = String(left.sortName || left.title || '').trim();
      const rightName = String(right.sortName || right.title || '').trim();
      comparison = leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
    }
    return comparison === 0
      ? manualOrder.get(leftId) - manualOrder.get(rightId)
      : comparison * direction;
  });
}

export function nearestGroupGap(rects, clientY) {
  if (!rects.length || !Number.isFinite(clientY)) return -1;
  const gapPositions = [rects[0].top];
  for (let index = 1; index < rects.length; index += 1) {
    gapPositions.push((rects[index - 1].bottom + rects[index].top) / 2);
  }
  gapPositions.push(rects[rects.length - 1].bottom);

  return gapPositions.reduce((nearestIndex, position, index) => (
    Math.abs(clientY - position) < Math.abs(clientY - gapPositions[nearestIndex])
      ? index
      : nearestIndex
  ), 0);
}

export function reorderGroup(groups, sourceId, gapIndex) {
  const sourceIndex = groups.findIndex((group) => group.id === sourceId);
  if (sourceIndex < 0 || !Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > groups.length) return groups;

  const source = groups[sourceIndex];
  const reordered = groups.filter((group) => group.id !== sourceId);
  const adjustedIndex = gapIndex - (sourceIndex < gapIndex ? 1 : 0);
  reordered.splice(adjustedIndex, 0, source);
  return reordered;
}

export function moveSession(groups, sessionId, targetGroupId, beforeSessionId = null, viewDirection = 'asc') {
  if (!groups.some((group) => group.id === targetGroupId)) return groups;

  const moved = groups.map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter((id) => id !== sessionId)
  }));
  const target = moved.find((group) => group.id === targetGroupId);
  if (viewDirection === 'desc') {
    const visualIds = [...target.sessionIds].reverse();
    const beforeVisualIndex = beforeSessionId ? visualIds.indexOf(beforeSessionId) : -1;
    visualIds.splice(beforeVisualIndex >= 0 ? beforeVisualIndex : visualIds.length, 0, sessionId);
    target.sessionIds = visualIds.reverse();
    return moved;
  }
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
        inputRequired: Boolean(session.inputRequired),
        attentionCycleId: typeof session.attentionCycleId === 'string' ? session.attentionCycleId.slice(0, 200) : '',
        activityArmed: Boolean(session.activityArmed),
        displayName: typeof session.displayName === 'string' ? session.displayName : '',
        summary: typeof session.summary === 'string' ? session.summary : '',
        agent: typeof session.agent === 'string' ? session.agent : '',
        hasUserActivity: Boolean(session.hasUserActivity),
        aiInitialSummaryDone: typeof session.aiInitialSummaryDone === 'boolean' ? session.aiInitialSummaryDone : null,
        lastAiSummaryAt: Number.isFinite(session.lastAiSummaryAt) && session.lastAiSummaryAt > 0 ? session.lastAiSummaryAt : 0,
        lastAiContextActivityAt: Number.isFinite(session.lastAiContextActivityAt) && session.lastAiContextActivityAt > 0 ? session.lastAiContextActivityAt : 0,
        staleAiSummaryDone: Boolean(session.staleAiSummaryDone),
        createdAt: Number.isFinite(session.createdAt) && session.createdAt > 0 ? session.createdAt : 0,
        lastResponseAt: Number.isFinite(session.lastResponseAt) && session.lastResponseAt > 0 ? session.lastResponseAt : 0,
        links: Array.isArray(session.links)
          ? session.links
            .map((link) => ({
              url: normalizeGithubPullRequestUrl(link?.url),
              seenAt: Number.isFinite(link?.seenAt) ? link.seenAt : 0
            }))
            .filter((link) => link.url)
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
          sortBy: normalizeGroupSort(group.sortBy),
          sortDirection: normalizeSortDirection(group.sortDirection),
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
      savedAt: Number.isFinite(value.savedAt) && value.savedAt > 0 ? value.savedAt : 0,
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

export function newestSavedWorkspace(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  return fallback.savedAt > primary.savedAt ? fallback : primary;
}
