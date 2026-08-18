import test from 'node:test';
import assert from 'node:assert/strict';
import { isBareAgentLaunchCommand, scanTerminalUrls, stripTerminalControlInput, terminalWheelAmount } from '../src/activity.js';

test('bare coding-agent launches do not count as naming context', () => {
  assert.equal(isBareAgentLaunchCommand('codex'), true);
  assert.equal(isBareAgentLaunchCommand('/usr/local/bin/claude --dangerously-skip-permissions'), true);
  assert.equal(isBareAgentLaunchCommand('sudo hermes'), true);
  assert.equal(isBareAgentLaunchCommand('codex fix the auth failure'), false);
  assert.equal(isBareAgentLaunchCommand('fix the auth failure'), false);
});

test('plain wheel scrolls terminal history while Ctrl+wheel passes through', () => {
  assert.equal(terminalWheelAmount({ ctrlKey: false, deltaY: -108 }), -3);
  assert.equal(terminalWheelAmount({ ctrlKey: false, deltaY: 72 }), 2);
  assert.equal(terminalWheelAmount({ ctrlKey: true, deltaY: -108 }), null);
  assert.equal(terminalWheelAmount({ ctrlKey: false, deltaY: 0 }), null);
});

test('terminal-generated control replies do not count as user input', () => {
  assert.equal(stripTerminalControlInput('\x1b[I\x1b[?1;2c\x1b[12;40R\x1bOA'), '');
  assert.equal(stripTerminalControlInput('\x1b[200~fix auth\x1b[201~\r'), 'fix auth\r');
  assert.equal(stripTerminalControlInput('fix\x1b[D token\r'), 'fix token\r');
});

test('GitHub pull request URLs are captured across terminal output chunks', () => {
  const first = scanTerminalUrls('', 'Review https://github.com/Andorra-Labs/Andorra-Labs-Alpha/pu');
  assert.deepEqual(first.urls, []);
  const second = scanTerminalUrls(first.buffer, 'll/684 before merging\n');
  assert.deepEqual(second.urls, ['https://github.com/Andorra-Labs/Andorra-Labs-Alpha/pull/684']);
});

test('GitHub links are limited to pull requests while other HTTP links remain available', () => {
  const result = scanTerminalUrls('', [
    'https://github.com/Andorra-Labs/Andorra-Labs-Alpha/issues/12',
    'https://docs.example.com/setup'
  ].join(' '));
  assert.deepEqual(result.urls, ['https://docs.example.com/setup']);
});
