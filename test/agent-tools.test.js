import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionTools } from '../electron/agent/session-tools.js';

function harness() {
  const calls = [];
  const tools = createSessionTools({
    listSessions: (input) => ({ active: [], input }),
    getSessionContext: (id) => ({ id, context: 'done' }),
    createSession: (input) => { calls.push(['create', input]); return { created: true, ...input }; },
    requestArchive: (input) => { calls.push(['archive', input]); return { pendingConfirmation: true }; },
    requestTerminalInput: (input) => { calls.push(['input', input]); return { pendingConfirmation: true }; },
    getPullRequest: (input) => { calls.push(['get-pr', input]); return { title: 'PR' }; },
    requestGithubComment: (input) => { calls.push(['comment', input]); return { pendingConfirmation: true }; },
    createCustomTool: (input) => { calls.push(['custom', input]); return { created: true }; },
    listCustomTools: () => []
  });
  return { byName: Object.fromEntries(tools.map((item) => [item.name, item])), calls };
}

test('Strands session tools expose bounded, confirmation-gated actions', async () => {
  const { byName, calls } = harness();
  const created = await byName.create_session.invoke({ name: 'Fix mobile scroll', groupName: 'SideTerm' });
  const archived = await byName.archive_session.invoke({ sessionId: 'session-1', summary: 'Tests pass', outcome: 'completed' });
  const proposed = await byName.request_terminal_input.invoke({ sessionId: 'session-2', input: 'npm test\r', reason: 'Verify the fix' });
  assert.equal(created.created, true);
  assert.equal(archived.pendingConfirmation, true);
  assert.equal(proposed.pendingConfirmation, true);
  assert.deepEqual(calls.map(([kind]) => kind), ['create', 'archive', 'input']);
});

test('GitHub writes are confirmation-gated and custom tools are constrained', async () => {
  const { byName, calls } = harness();
  const read = await byName.get_github_pull_request.invoke({ pullRequestUrl: 'https://github.com/hyudryu/SideTerm/pull/2' });
  const comment = await byName.request_github_comment.invoke({
    pullRequestUrl: 'https://github.com/hyudryu/SideTerm/pull/2', body: 'Ready for another review.', reason: 'Request review'
  });
  const custom = await byName.create_custom_tool.invoke({ name: 'status_digest', description: 'Summarize status', instructions: 'List verified changes only.' });
  assert.equal(read.title, 'PR');
  assert.equal(comment.pendingConfirmation, true);
  assert.equal(custom.created, true);
  assert.deepEqual(calls.map(([kind]) => kind), ['get-pr', 'comment', 'custom']);
});

test('Strands session tool schemas reject missing exact identifiers', async () => {
  const { byName } = harness();
  await assert.rejects(() => byName.get_session_context.invoke({}), /invalid input/i);
  await assert.rejects(() => byName.request_terminal_input.invoke({ sessionId: '', input: 'ls', reason: 'Inspect' }), /(too small|invalid input)/i);
});

test('terminal input defaults to submitting and can opt out explicitly', async () => {
  const { byName, calls } = harness();
  await byName.request_terminal_input.invoke({ sessionId: 'session-2', input: 'npm test', reason: 'Verify' });
  await byName.request_terminal_input.invoke({ sessionId: 'session-2', input: 'password', submit: false, reason: 'Pre-type' });
  assert.deepEqual(calls, [
    ['input', { sessionId: 'session-2', input: 'npm test', submit: true, reason: 'Verify' }],
    ['input', { sessionId: 'session-2', input: 'password', submit: false, reason: 'Pre-type' }]
  ]);
});
