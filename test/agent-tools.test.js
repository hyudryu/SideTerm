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
    requestTerminalInput: (input) => { calls.push(['input', input]); return { pendingConfirmation: true }; }
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

test('Strands session tool schemas reject missing exact identifiers', async () => {
  const { byName } = harness();
  await assert.rejects(() => byName.get_session_context.invoke({}), /invalid input/i);
  await assert.rejects(() => byName.request_terminal_input.invoke({ sessionId: '', input: 'ls', reason: 'Inspect' }), /(too small|invalid input)/i);
});
