const test = require('node:test');
const assert = require('node:assert/strict');
const { DeepSeekHarnessBackend } = require('../electron/sessions/harness-backend.cjs');

test('Harness instructions use semantic delivery instead of PTY typing', async () => {
  const calls = [];
  const backend = new DeepSeekHarnessBackend({ request: async (method, input) => calls.push({ method, input }), subscribe: () => () => {} });
  await backend.sendInstruction('agent-a', 'Fix the review', 'auto');
  await backend.sendInstruction('agent-a', 'Stop editing generated files', 'steer');
  await backend.sendInstruction('agent-a', 'PR 9 changed', 'inject');
  assert.deepEqual(calls.map((item) => item.method), ['agents.followup', 'agents.steer', 'agents.inject']);
});
