import test from 'node:test';
import assert from 'node:assert/strict';
import { isBareAgentLaunchCommand, terminalWheelAmount } from '../src/activity.js';

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
