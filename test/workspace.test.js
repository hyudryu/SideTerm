import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GROUP_COLOR,
  WORKSPACE_VERSION,
  applyTerminalCheckpointBackups,
  createSerializedAsyncQueue,
  createGroup,
  decodeTerminalState,
  encodeTerminalState,
  groupTerminalCheckpointAcknowledgements,
  moveSession,
  nearestGroupGap,
  newestSavedWorkspace,
  parseSavedWorkspace,
  persistedCheckpointCoversDelivery,
  persistWorkspaceCopies,
  removeSessionFromGroups,
  reorderGroup,
  serializeWorkspaceWithinBudget,
  sortedSessionIds
} from '../src/workspace.js';

test('required workspace persistence rejects before spawn when both durable copies fail', async () => {
  let failures = 0;
  await assert.rejects(persistWorkspaceCopies('{}', {
    saveBrowser: () => { throw new Error('browser full'); },
    saveBackup: async () => { throw new Error('backup unavailable'); },
    required: true,
    onTotalFailure: () => { failures += 1; }
  }), /backup unavailable/);
  assert.equal(failures, 1);

  assert.equal(await persistWorkspaceCopies('{}', {
    saveBrowser: () => {},
    saveBackup: async () => { throw new Error('backup unavailable'); },
    required: true
  }), true);
});

test('host delivery acknowledgements require the exact persisted generation and revision', () => {
  const session = { lastPersistedHostGeneration: 'generation-a', lastPersistedOutputRevision: 4 };
  assert.equal(persistedCheckpointCoversDelivery(session, {
    hostGeneration: 'generation-a', outputRevision: 4
  }), true);
  assert.equal(persistedCheckpointCoversDelivery(session, {
    hostGeneration: 'generation-a', outputRevision: 5
  }), false);
  assert.equal(persistedCheckpointCoversDelivery(session, {
    hostGeneration: 'generation-b', outputRevision: 4
  }), false);
});

test('terminal checkpoint acknowledgements are batched per session', () => {
  const first = { id: 'first', outputRevision: 2 };
  const second = { id: 'second', outputRevision: 3 };
  const laterFirst = { id: 'first', outputRevision: 4 };

  assert.deepEqual(groupTerminalCheckpointAcknowledgements([first, second, laterFirst]), [
    { id: 'first', acknowledgements: [first, laterFirst] },
    { id: 'second', acknowledgements: [second] }
  ]);
});

test('workspace persistence is serialized before a later snapshot can replace it', async () => {
  const enqueue = createSerializedAsyncQueue();
  let releaseCheckpoint;
  const checkpointBlocked = new Promise((resolve) => { releaseCheckpoint = resolve; });
  let checkpointPersisted = false;
  let finalBrowserCopy = '';
  let finalBackupCopy = '';

  const checkpointSave = enqueue(async () => {
    await checkpointBlocked;
    finalBrowserCopy = 'generation-a:revision-7';
    finalBackupCopy = 'generation-a:revision-7';
    checkpointPersisted = true;
  });
  const ordinarySave = enqueue(async () => {
    const snapshot = checkpointPersisted ? 'generation-a:revision-7' : 'dropped';
    finalBrowserCopy = snapshot;
    await Promise.resolve();
    finalBackupCopy = snapshot;
  });

  await Promise.resolve();
  assert.equal(checkpointPersisted, false);
  releaseCheckpoint();
  await Promise.all([checkpointSave, ordinarySave]);
  assert.equal(finalBrowserCopy, 'generation-a:revision-7');
  assert.equal(finalBackupCopy, 'generation-a:revision-7');
});

test('large terminal checkpoints use a lossless compressed representation', () => {
  const state = `\u001bc\u001b[?1049h${' '.repeat(1_500_000)}\u001b[?2004h`;
  const encoded = encodeTerminalState(state);

  assert.ok(encoded.length < state.length);
  assert.equal(decodeTerminalState(encoded), state);
  assert.equal(decodeTerminalState(state), state);
});

test('terminal checkpoint encoding and decoding reject over-limit state', () => {
  const overLimit = 'z'.repeat((32 * 1024 * 1024) + 1);
  assert.equal(encodeTerminalState(overLimit), '');
  assert.equal(decodeTerminalState(overLimit), '');
  assert.equal(decodeTerminalState(`sideterm:rle:\0${(32 * 1024 * 1024 + 1).toString(36)}:z`), '');
});

test('workspace budgeting preserves session/group identity and clears dropped checkpoints', () => {
  const workspace = {
    version: WORKSPACE_VERSION,
    activeId: 'active',
    activeGroupId: 'group',
    groups: [{ id: 'group', title: 'Group', sessionIds: ['inactive', 'active'] }],
    sessions: [
      { id: 'inactive', groupId: 'group', history: 'old', terminalState: 'x'.repeat(600), hostGeneration: 'old-generation', durableOutputRevision: 8, links: [] },
      { id: 'active', groupId: 'group', history: 'current', terminalState: 'y'.repeat(200), hostGeneration: 'active-generation', durableOutputRevision: 9, links: [] }
    ]
  };
  const activeOnly = structuredClone(workspace);
  Object.assign(activeOnly.sessions[0], { terminalState: '', hostGeneration: '', durableOutputRevision: 0 });
  const budget = new TextEncoder().encode(JSON.stringify(activeOnly)).byteLength;
  const result = serializeWorkspaceWithinBudget(workspace, budget);

  assert.ok(new TextEncoder().encode(result.serialized).byteLength <= budget);
  assert.deepEqual(result.workspace.groups[0].sessionIds, ['inactive', 'active']);
  assert.equal(result.workspace.sessions[0].terminalState, '');
  assert.equal(result.workspace.sessions[0].hostGeneration, '');
  assert.equal(result.workspace.sessions[0].durableOutputRevision, 0);
  assert.equal(result.workspace.sessions[1].terminalState.length, 200);
  assert.equal(workspace.sessions[0].terminalState.length, 600);
});

test('workspace budgeting retains checkpoints with pending acknowledgements', () => {
  const workspace = {
    version: WORKSPACE_VERSION,
    activeId: 'active',
    activeGroupId: 'group',
    groups: [{ id: 'group', title: 'Group', sessionIds: ['pending', 'active'] }],
    sessions: [
      { id: 'pending', groupId: 'group', history: 'h'.repeat(500), terminalState: 'p'.repeat(300), hostGeneration: 'pending-generation', durableOutputRevision: 7, links: [] },
      { id: 'active', groupId: 'group', history: 'h'.repeat(500), terminalState: 'a'.repeat(600), hostGeneration: 'active-generation', durableOutputRevision: 8, links: [] }
    ]
  };
  const pendingOnly = structuredClone(workspace);
  for (const session of pendingOnly.sessions) session.history = '';
  Object.assign(pendingOnly.sessions[1], { terminalState: '', hostGeneration: '', durableOutputRevision: 0 });
  const budget = new TextEncoder().encode(JSON.stringify(pendingOnly)).byteLength;
  const result = serializeWorkspaceWithinBudget(workspace, budget, new Set(['pending']));

  assert.equal(result.workspace.sessions[0].terminalState.length, 300);
  assert.equal(result.workspace.sessions[0].hostGeneration, 'pending-generation');
  assert.equal(result.workspace.sessions[0].durableOutputRevision, 7);
  assert.equal(result.workspace.sessions[1].terminalState, '');
});

function fixture() {
  const first = createGroup('first', 'First');
  const second = createGroup('second', 'Second');
  first.sessionIds = ['a', 'b'];
  second.sessionIds = ['c'];
  return [first, second];
}

test('groups reorder at gaps and adjust for the removed source', () => {
  const groups = [...fixture(), createGroup('third', 'Third')];
  assert.deepEqual(reorderGroup(groups, 'first', 3).map((group) => group.id), ['second', 'third', 'first']);
  assert.deepEqual(reorderGroup(groups, 'third', 0).map((group) => group.id), ['third', 'first', 'second']);
  assert.deepEqual(reorderGroup(groups, 'second', 1).map((group) => group.id), ['first', 'second', 'third']);
  assert.deepEqual(reorderGroup(groups, 'second', 2).map((group) => group.id), ['first', 'second', 'third']);
});

test('group drag positions resolve to shared gaps between adjacent groups', () => {
  const rects = [
    { top: 10, bottom: 100 },
    { top: 108, bottom: 198 },
    { top: 206, bottom: 296 }
  ];
  assert.equal(nearestGroupGap(rects, 10), 0);
  assert.equal(nearestGroupGap(rects, 95), 1);
  assert.equal(nearestGroupGap(rects, 104), 1);
  assert.equal(nearestGroupGap(rects, 113), 1);
  assert.equal(nearestGroupGap(rects, 193), 2);
  assert.equal(nearestGroupGap(rects, 296), 3);
});

test('sessions reorder within a group and transfer across groups', () => {
  const reordered = moveSession(fixture(), 'b', 'first', 'a');
  assert.deepEqual(reordered[0].sessionIds, ['b', 'a']);

  const transferred = moveSession(reordered, 'a', 'second', 'c');
  assert.deepEqual(transferred[0].sessionIds, ['b']);
  assert.deepEqual(transferred[1].sessionIds, ['a', 'c']);

  const reversed = moveSession(fixture(), 'c', 'first', 'a', 'desc');
  assert.deepEqual(reversed[0].sessionIds, ['a', 'c', 'b']);
  assert.deepEqual([...reversed[0].sessionIds].reverse(), ['b', 'c', 'a']);
});

test('session removal cleans every group', () => {
  assert.deepEqual(removeSessionFromGroups(fixture(), 'a').map((group) => group.sessionIds), [['b'], ['c']]);
});

test('per-group sorting preserves canonical manual order', () => {
  const group = createGroup('first', 'First');
  group.sessionIds = ['a', 'b', 'c'];
  const sessions = new Map([
    ['a', { title: 'Hidden A', sortName: 'Zebra', createdAt: 10, lastResponseAt: 30 }],
    ['b', { title: 'Hidden B', sortName: 'Alpha', createdAt: 30, lastResponseAt: 10 }],
    ['c', { title: 'Hidden C', sortName: 'Middle', createdAt: 20, lastResponseAt: 20 }]
  ]);

  assert.deepEqual(sortedSessionIds(group, sessions), ['a', 'b', 'c']);
  group.sortDirection = 'desc';
  assert.deepEqual(sortedSessionIds(group, sessions), ['c', 'b', 'a']);
  group.sortBy = 'created';
  assert.deepEqual(sortedSessionIds(group, sessions), ['b', 'c', 'a']);
  group.sortBy = 'response';
  assert.deepEqual(sortedSessionIds(group, sessions), ['a', 'c', 'b']);
  group.sortBy = 'name';
  group.sortDirection = 'asc';
  assert.deepEqual(sortedSessionIds(group, sessions), ['b', 'c', 'a']);
  assert.deepEqual(group.sessionIds, ['a', 'b', 'c']);
});

test('saved workspaces validate, deduplicate, and restore unassigned sessions', () => {
  const saved = parseSavedWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    activeId: 'b',
    activeGroupId: 'missing',
    groups: [
      { id: 'first', title: ' Work ', color: '#A142F4', sortBy: 'response', sortDirection: 'desc', sessionIds: ['a', 'a'] },
      { id: 'second', title: '', color: 'not-a-color', collapsed: true, sessionIds: [] }
    ],
    sessions: [
      { id: 'a', groupId: 'first', title: 'One', manualTitle: true, cwd: '/tmp', history: 'hello', terminalState: '\u001b[?1049hfull screen', terminalStateCols: 132, terminalStateRows: 41, hostGeneration: 'generation-a', durableOutputRevision: 17, notified: true, inputRequired: true, attentionCycleId: 'cycle-a', activityArmed: true, displayName: 'API work', summary: 'Fix auth', agent: 'Codex', aiInitialSummaryDone: true, lastAiSummaryAt: 1234, lastAiContextActivityAt: 1220, staleAiSummaryDone: true, createdAt: 10, lastResponseAt: 20, links: [{ url: 'https://example.com/docs', seenAt: 0 }, { url: 'https://github.com/a/b/pull/1/files', seenAt: 1 }] },
      { id: 'b', groupId: 'second', title: 'Two' }
    ]
  }));

  assert.equal(saved.groups[0].title, 'Work');
  assert.equal(saved.groups[0].color, '#a142f4');
  assert.equal(saved.groups[0].sortBy, 'response');
  assert.equal(saved.groups[0].sortDirection, 'desc');
  assert.deepEqual(saved.groups[0].sessionIds, ['a']);
  assert.deepEqual(saved.groups[1].sessionIds, ['b']);
  assert.equal(saved.groups[1].color, DEFAULT_GROUP_COLOR);
  assert.equal(saved.groups[1].collapsed, true);
  assert.equal(saved.activeGroupId, 'first');
  assert.equal(saved.sessions[0].displayName, 'API work');
  assert.equal(saved.sessions[0].manualTitle, true);
  assert.equal(saved.sessions[0].attentionCycleId, 'cycle-a');
  assert.equal(saved.sessions[0].inputRequired, true);
  assert.equal(saved.sessions[0].activityArmed, true);
  assert.equal(saved.sessions[0].aiInitialSummaryDone, true);
  assert.equal(saved.sessions[0].lastAiSummaryAt, 1234);
  assert.equal(saved.sessions[0].lastAiContextActivityAt, 1220);
  assert.equal(saved.sessions[0].staleAiSummaryDone, true);
  assert.equal(saved.sessions[0].createdAt, 10);
  assert.equal(saved.sessions[0].lastResponseAt, 20);
  assert.equal(saved.sessions[0].terminalState, '\u001b[?1049hfull screen');
  assert.equal(saved.sessions[0].terminalStateCols, 132);
  assert.equal(saved.sessions[0].terminalStateRows, 41);
  assert.equal(saved.sessions[0].hostGeneration, 'generation-a');
  assert.equal(saved.sessions[0].durableOutputRevision, 17);
  assert.equal(saved.sessions[0].links.length, 1);
  assert.equal(saved.sessions[0].links[0].url, 'https://github.com/a/b/pull/1');
});

test('invalid saved workspace data is ignored', () => {
  assert.equal(parseSavedWorkspace('{oops'), null);
  assert.equal(parseSavedWorkspace(JSON.stringify({ version: 999, groups: [], sessions: [] })), null);
});

test('workspace checkpoints require a valid state and matching host generation', () => {
  const parsed = parseSavedWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    groups: [{ id: 'group', title: 'Group', sessionIds: ['empty', 'missing-generation'] }],
    sessions: [
      { id: 'empty', groupId: 'group', terminalState: '', hostGeneration: 'host-a', durableOutputRevision: 5 },
      { id: 'missing-generation', groupId: 'group', terminalState: '\u001bcstate', durableOutputRevision: 6 }
    ]
  }));

  assert.equal(parsed.sessions[0].hostGeneration, '');
  assert.equal(parsed.sessions[0].durableOutputRevision, 0);
  assert.equal(parsed.sessions[1].hostGeneration, '');
  assert.equal(parsed.sessions[1].durableOutputRevision, 0);
});

test('pending initial AI context survives workspace restoration', () => {
  const parsed = parseSavedWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    groups: [{ id: 'first', title: 'First', sessionIds: ['pending', 'legacy'] }],
    sessions: [
      { id: 'pending', groupId: 'first', aiInitialSummaryDone: false },
      { id: 'legacy', groupId: 'first' }
    ]
  }));
  assert.equal(parsed.sessions[0].aiInitialSummaryDone, false);
  assert.equal(parsed.sessions[1].aiInitialSummaryDone, null);
});

test('legacy sessions retain an unknown creation-time tie', () => {
  const parsed = parseSavedWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    groups: [{ id: 'first', title: 'First', sessionIds: ['b', 'a'] }],
    sessions: [
      { id: 'a', groupId: 'first', title: 'A' },
      { id: 'b', groupId: 'first', title: 'B' }
    ]
  }));

  assert.deepEqual(parsed.sessions.map((session) => session.createdAt), [0, 0]);
  const lookup = new Map(parsed.sessions.map((session) => [session.id, session]));
  parsed.groups[0].sortBy = 'created';
  assert.deepEqual(sortedSessionIds(parsed.groups[0], lookup), ['b', 'a']);
});

test('workspace restoration chooses the newest valid browser or native copy', () => {
  const native = { savedAt: 10, groups: [{ id: 'native' }] };
  const browser = { savedAt: 20, groups: [{ id: 'browser' }] };
  assert.equal(newestSavedWorkspace(native, browser), browser);
  assert.equal(newestSavedWorkspace(browser, native), browser);
  assert.equal(newestSavedWorkspace(native, null), native);
});

test('per-session checkpoint sidecars overlay workspace sessions without replacing a newer generation', () => {
  const workspace = {
    version: WORKSPACE_VERSION,
    groups: [],
    sessions: [
      { id: 'dropped-inline', hostGeneration: '', durableOutputRevision: 0, terminalState: '' },
      { id: 'new-generation', hostGeneration: 'new', durableOutputRevision: 1, terminalState: '\u001bcnew' }
    ]
  };
  const restored = applyTerminalCheckpointBackups(workspace, JSON.stringify([
    { id: 'dropped-inline', terminalState: '\u001bcsidecar', mobileTerminalState: '\u001bcmobile', terminalStateCols: 90, terminalStateRows: 32, hostGeneration: 'host-a', durableOutputRevision: 8 },
    { id: 'new-generation', terminalState: '\u001bcstale', hostGeneration: 'old', durableOutputRevision: 99 }
  ]));

  assert.equal(restored.sessions[0].terminalState, '\u001bcsidecar');
  assert.equal(restored.sessions[0].mobileTerminalState, '\u001bcmobile');
  assert.equal(restored.sessions[0].hostGeneration, 'host-a');
  assert.equal(restored.sessions[0].durableOutputRevision, 8);
  assert.equal(restored.sessions[1].terminalState, '\u001bcnew');
  assert.equal(restored.sessions[1].hostGeneration, 'new');
});
