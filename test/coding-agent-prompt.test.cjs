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

test('an idle Kimi boxed prompt is recognized despite ANSI chrome', () => {
  const kimiScreen = `\x1b[2K \x1b[38;2;79;168;255m│\x1b[39m  \x1b[1m\x1b[38;2;79;168;255mWelcome to Kimi Code!\x1b[39m\x1b[22m  \x1b[38;2;79;168;255m│\x1b[39m\x1b[0m
\x1b[2K \x1b[38;2;79;168;255m│\x1b[39m \x1b[38;2;224;224;224mplan\x1b[39m  \x1b[38;2;224;224;224mK3 thinking: high\x1b[39m  \x1b[38;2;136;136;136mmain [±]\x1b[39m\x1b[0m
\x1b[2K \x1b[38;2;79;168;255m│\x1b[39m > \x1b[7m \x1b[0m`;
  assert.equal(isIdleCodingAgentPrompt({
    agent: 'Kimi',
    busy: false,
    currentCommand: 'kimi',
    screen: kimiScreen
  }), true);
  assert.equal(isIdleCodingAgentPrompt({
    agent: 'Kimi',
    busy: true,
    currentCommand: 'kimi',
    screen: kimiScreen
  }), false);
});
