const assert = require('node:assert/strict');
const test = require('node:test');
const { isIdleCodingAgentPrompt } = require('../electron/agent/coding-agent-prompt.cjs');

test('automatic review requests require an idle live coding-agent process', () => {
  const idleScreen = 'OpenAI Codex\n› Ask Codex to do anything';
  assert.equal(isIdleCodingAgentPrompt({ agent: 'Codex', busy: false, currentCommand: 'codex', screen: idleScreen }), true);
  assert.equal(isIdleCodingAgentPrompt({ agent: 'Codex', busy: true, currentCommand: 'codex', screen: idleScreen }), false);
  assert.equal(isIdleCodingAgentPrompt({ agent: 'Codex', busy: false, currentCommand: 'bash', screen: 'shell\n$ ' }), false);
  assert.equal(isIdleCodingAgentPrompt({ agent: '', busy: false, currentCommand: 'codex', screen: idleScreen }), false);
  assert.equal(isIdleCodingAgentPrompt({
    agent: 'Codex', busy: false, currentCommand: 'codex', screen: `${idleScreen}\n• Working (2s • esc to interrupt)`
  }), false);
});

test('a branded idle TUI prompt is accepted when the process name is wrapped', () => {
  assert.equal(isIdleCodingAgentPrompt({
    agent: 'Hermes',
    busy: false,
    currentCommand: 'node',
    screen: 'Hermes Agent\n⚕ ❯ '
  }), true);
});
