import { normalizeGithubPullRequestUrl } from './activity.js';

export const WORKSPACE_VERSION = 1;
export const DEFAULT_GROUP_COLOR = '#60cdff';
export const GROUP_SORTS = ['default', 'created', 'response', 'name'];
export const MAX_WORKSPACE_BACKUP_BYTES = 7 * 1024 * 1024;

const TERMINAL_STATE_COMPRESSION_PREFIX = 'sideterm:rle:';
const TERMINAL_STATE_RUN_MARKER = '\0';
const MAX_DECOMPRESSED_TERMINAL_STATE_CHARS = 32 * 1024 * 1024;

function serializedByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function encodeTerminalState(value) {
  const state = String(value || '');
  if (!state || state.length > MAX_DECOMPRESSED_TERMINAL_STATE_CHARS) return '';
  const encoded = [];
  for (let index = 0; index < state.length;) {
    const character = state[index];
    let end = index + 1;
    while (end < state.length && state[end] === character) end += 1;
    const count = end - index;
    if (character === TERMINAL_STATE_RUN_MARKER || count >= 4) {
      encoded.push(TERMINAL_STATE_RUN_MARKER, count.toString(36), ':', character);
    } else {
      encoded.push(state.slice(index, end));
    }
    index = end;
  }
  const compressed = `${TERMINAL_STATE_COMPRESSION_PREFIX}${encoded.join('')}`;
  return compressed.length < state.length ? compressed : state;
}

export function decodeTerminalState(value) {
  const stored = String(value || '');
  if (!stored.startsWith(TERMINAL_STATE_COMPRESSION_PREFIX)) {
    return stored.length <= MAX_DECOMPRESSED_TERMINAL_STATE_CHARS ? stored : '';
  }
  const body = stored.slice(TERMINAL_STATE_COMPRESSION_PREFIX.length);
  const decoded = [];
  let decodedLength = 0;
  for (let index = 0; index < body.length;) {
    const marker = body.indexOf(TERMINAL_STATE_RUN_MARKER, index);
    if (marker < 0) {
      const remainder = body.slice(index);
      if (decodedLength + remainder.length > MAX_DECOMPRESSED_TERMINAL_STATE_CHARS) return '';
      decoded.push(remainder);
      break;
    }
    if (marker > index) {
      const literal = body.slice(index, marker);
      if (decodedLength + literal.length > MAX_DECOMPRESSED_TERMINAL_STATE_CHARS) return '';
      decoded.push(literal);
      decodedLength += literal.length;
    }
    const separator = body.indexOf(':', marker + 1);
    if (separator < 0 || separator - marker > 8 || separator + 1 >= body.length) return '';
    const countText = body.slice(marker + 1, separator);
    if (!/^[0-9a-z]+$/.test(countText)) return '';
    const count = Number.parseInt(countText, 36);
    if (!Number.isSafeInteger(count) || count <= 0
      || decodedLength + count > MAX_DECOMPRESSED_TERMINAL_STATE_CHARS) return '';
    decoded.push(body[separator + 1].repeat(count));
    decodedLength += count;
    index = separator + 2;
  }
  return decoded.join('');
}

export function applyTerminalCheckpointBackups(workspace, raw) {
  if (!workspace) return workspace;
  let values;
  try {
    values = JSON.parse(String(raw || ''));
  } catch {
    return workspace;
  }
  if (!Array.isArray(values)) return workspace;
  const checkpoints = new Map();
  for (const value of values) {
    const terminalState = typeof value?.terminalState === 'string'
      && value.terminalState.length > 0
      && value.terminalState.length <= MAX_DECOMPRESSED_TERMINAL_STATE_CHARS
      && decodeTerminalState(value.terminalState)
      ? value.terminalState
      : '';
    const id = typeof value?.id === 'string' ? value.id : '';
    const hostGeneration = typeof value?.hostGeneration === 'string'
      ? value.hostGeneration.slice(0, 100)
      : '';
    if (!id || !terminalState || !hostGeneration
      || !Number.isSafeInteger(value.durableOutputRevision)
      || value.durableOutputRevision < 0) continue;
    const checkpoint = {
      terminalState,
      mobileTerminalState: typeof value.mobileTerminalState === 'string'
        && value.mobileTerminalState.length <= MAX_DECOMPRESSED_TERMINAL_STATE_CHARS
        && decodeTerminalState(value.mobileTerminalState)
        ? value.mobileTerminalState
        : '',
      terminalStateCols: Number.isInteger(value.terminalStateCols)
        ? Math.min(1_000, Math.max(2, value.terminalStateCols))
        : 80,
      terminalStateRows: Number.isInteger(value.terminalStateRows)
        ? Math.min(500, Math.max(1, value.terminalStateRows))
        : 24,
      hostGeneration,
      durableOutputRevision: value.durableOutputRevision
    };
    const existing = checkpoints.get(id);
    if (!existing || checkpoint.durableOutputRevision > existing.durableOutputRevision) {
      checkpoints.set(id, checkpoint);
    }
  }
  return {
    ...workspace,
    sessions: workspace.sessions.map((session) => {
      const checkpoint = checkpoints.get(session.id);
      if (!checkpoint || (session.hostGeneration
        && session.hostGeneration !== checkpoint.hostGeneration)) return session;
      if (session.hostGeneration === checkpoint.hostGeneration
        && session.durableOutputRevision > checkpoint.durableOutputRevision) return session;
      return { ...session, ...checkpoint };
    })
  };
}

export function persistedCheckpointCoversDelivery(session, delivery) {
  return Boolean(session
    && session.lastPersistedHostGeneration === String(delivery?.hostGeneration || '')
    && Number.isSafeInteger(delivery?.outputRevision)
    && delivery.outputRevision >= 0
    && session.lastPersistedOutputRevision >= delivery.outputRevision);
}

export function groupTerminalCheckpointAcknowledgements(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(entry);
  }
  return [...grouped].map(([id, acknowledgements]) => ({ id, acknowledgements }));
}

export function activeTerminalCheckpointAcknowledgements(entries, sessions) {
  return entries.filter((entry) => (
    entry?.session
    && !entry.session.checkpointRetired
    && sessions.get(entry.id) === entry.session
  ));
}

export function createSerializedAsyncQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}

export function serializeWorkspaceWithinBudget(
  workspace, maximumBytes = MAX_WORKSPACE_BACKUP_BYTES, protectedCheckpointSessionIds = new Set()
) {
  const durableWorkspace = {
    ...workspace,
    groups: workspace.groups.map((group) => ({ ...group, sessionIds: [...group.sessionIds] })),
    sessions: workspace.sessions.map((session) => ({
      ...session,
      links: Array.isArray(session.links) ? session.links.map((link) => ({ ...link })) : []
    }))
  };
  const encode = () => JSON.stringify(durableWorkspace);
  let serialized = encode();
  if (serializedByteLength(serialized) <= maximumBytes) {
    return { serialized, workspace: durableWorkspace };
  }

  for (const session of durableWorkspace.sessions) {
    if (!session.terminalState || session.hostGeneration) continue;
    session.terminalState = '';
    if ('mobileTerminalState' in session) session.mobileTerminalState = '';
    session.durableOutputRevision = 0;
  }
  serialized = encode();
  if (serializedByteLength(serialized) <= maximumBytes) {
    return { serialized, workspace: durableWorkspace };
  }

  const leastImportantFirst = [...durableWorkspace.sessions].sort((left, right) => {
    const leftProtected = protectedCheckpointSessionIds.has(left.id);
    const rightProtected = protectedCheckpointSessionIds.has(right.id);
    if (leftProtected !== rightProtected) return leftProtected ? 1 : -1;
    if (left.id === durableWorkspace.activeId) return 1;
    if (right.id === durableWorkspace.activeId) return -1;
    return String(right.terminalState || '').length - String(left.terminalState || '').length;
  });
  for (const session of leastImportantFirst) {
    if (!session.terminalState || protectedCheckpointSessionIds.has(session.id)) continue;
    session.terminalState = '';
    if ('mobileTerminalState' in session) session.mobileTerminalState = '';
    session.hostGeneration = '';
    session.durableOutputRevision = 0;
    serialized = encode();
    if (serializedByteLength(serialized) <= maximumBytes) {
      return { serialized, workspace: durableWorkspace };
    }
  }
  for (const session of leastImportantFirst) {
    if (!session.history) continue;
    session.history = '';
    serialized = encode();
    if (serializedByteLength(serialized) <= maximumBytes) {
      return { serialized, workspace: durableWorkspace };
    }
  }

  throw new Error('Workspace checkpoints exceed the durable backup limit.');
}

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
      .map((session) => {
        const terminalState = typeof session.terminalState === 'string'
          && session.terminalState.length > 0
          && session.terminalState.length <= MAX_WORKSPACE_BACKUP_BYTES
          && decodeTerminalState(session.terminalState)
          ? session.terminalState
          : '';
        const hostGeneration = terminalState && typeof session.hostGeneration === 'string'
          ? session.hostGeneration.slice(0, 100)
          : '';
        const durableOutputRevision = terminalState && hostGeneration
          && Number.isSafeInteger(session.durableOutputRevision)
          && session.durableOutputRevision >= 0
          ? session.durableOutputRevision
          : 0;
        const mobileTerminalState = terminalState && typeof session.mobileTerminalState === 'string'
          && session.mobileTerminalState.length <= MAX_WORKSPACE_BACKUP_BYTES
          && decodeTerminalState(session.mobileTerminalState)
          ? session.mobileTerminalState
          : '';
        return {
        id: session.id,
        groupId: session.groupId,
        title: typeof session.title === 'string' ? session.title : 'Terminal',
        manualTitle: Boolean(session.manualTitle),
        shell: typeof session.shell === 'string' ? session.shell : 'shell',
        cwd: typeof session.cwd === 'string' ? session.cwd : '',
        exited: Boolean(session.exited),
        exitCheckpointConfirmed: Boolean(session.exitCheckpointConfirmed),
        history: typeof session.history === 'string' ? session.history : '',
        terminalState,
        mobileTerminalState,
        terminalStateCols: Number.isInteger(session.terminalStateCols) && session.terminalStateCols >= 2
          ? Math.min(1_000, session.terminalStateCols)
          : 80,
        terminalStateRows: Number.isInteger(session.terminalStateRows) && session.terminalStateRows >= 1
          ? Math.min(500, session.terminalStateRows)
          : 24,
        hostGeneration,
        durableOutputRevision,
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
      };
      });
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
