import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GROUP_COLOR,
  WORKSPACE_VERSION,
  createGroup,
  moveSession,
  parseSavedWorkspace,
  removeSessionFromGroups,
  reorderGroup
} from '../src/workspace.js';

function fixture() {
  const first = createGroup('first', 'First');
  const second = createGroup('second', 'Second');
  first.sessionIds = ['a', 'b'];
  second.sessionIds = ['c'];
  return [first, second];
}

test('groups reorder before and after snap targets', () => {
  const groups = [...fixture(), createGroup('third', 'Third')];
  assert.deepEqual(reorderGroup(groups, 'first', 'third', 'after').map((group) => group.id), ['second', 'third', 'first']);
  assert.deepEqual(reorderGroup(groups, 'third', 'first', 'before').map((group) => group.id), ['third', 'first', 'second']);
});

test('sessions reorder within a group and transfer across groups', () => {
  const reordered = moveSession(fixture(), 'b', 'first', 'a');
  assert.deepEqual(reordered[0].sessionIds, ['b', 'a']);

  const transferred = moveSession(reordered, 'a', 'second', 'c');
  assert.deepEqual(transferred[0].sessionIds, ['b']);
  assert.deepEqual(transferred[1].sessionIds, ['a', 'c']);
});

test('session removal cleans every group', () => {
  assert.deepEqual(removeSessionFromGroups(fixture(), 'a').map((group) => group.sessionIds), [['b'], ['c']]);
});

test('saved workspaces validate, deduplicate, and restore unassigned sessions', () => {
  const saved = parseSavedWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    activeId: 'b',
    activeGroupId: 'missing',
    groups: [
      { id: 'first', title: ' Work ', color: '#A142F4', sessionIds: ['a', 'a'] },
      { id: 'second', title: '', color: 'not-a-color', collapsed: true, sessionIds: [] }
    ],
    sessions: [
      { id: 'a', groupId: 'first', title: 'One', manualTitle: true, cwd: '/tmp', history: 'hello', activityArmed: true, displayName: 'API work', summary: 'Fix auth', agent: 'Codex', aiInitialSummaryDone: true, lastAiSummaryAt: 1234, links: [{ url: 'https://github.com/a/b/pull/1', seenAt: 1 }] },
      { id: 'b', groupId: 'second', title: 'Two' }
    ]
  }));

  assert.equal(saved.groups[0].title, 'Work');
  assert.equal(saved.groups[0].color, '#a142f4');
  assert.deepEqual(saved.groups[0].sessionIds, ['a']);
  assert.deepEqual(saved.groups[1].sessionIds, ['b']);
  assert.equal(saved.groups[1].color, DEFAULT_GROUP_COLOR);
  assert.equal(saved.groups[1].collapsed, true);
  assert.equal(saved.activeGroupId, 'first');
  assert.equal(saved.sessions[0].displayName, 'API work');
  assert.equal(saved.sessions[0].manualTitle, true);
  assert.equal(saved.sessions[0].activityArmed, true);
  assert.equal(saved.sessions[0].aiInitialSummaryDone, true);
  assert.equal(saved.sessions[0].lastAiSummaryAt, 1234);
  assert.equal(saved.sessions[0].links[0].url, 'https://github.com/a/b/pull/1');
});

test('invalid saved workspace data is ignored', () => {
  assert.equal(parseSavedWorkspace('{oops'), null);
  assert.equal(parseSavedWorkspace(JSON.stringify({ version: 999, groups: [], sessions: [] })), null);
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
