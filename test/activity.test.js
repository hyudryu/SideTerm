import test from 'node:test';
import assert from 'node:assert/strict';
import { agentActivityState, canAutoArmAgentActivity, consumeTerminalInputEcho, isAgentWorkingText, isBareAgentLaunchCommand, normalizeGithubPullRequestUrl, restoredContextState, scanTerminalUrls, shouldKeepSessionBusy, stripTerminalControlInput, terminalStatusRowRange, terminalWheelAmount } from '../src/activity.js';

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

test('terminal input echo is separated from actual process output', () => {
  assert.deepEqual(consumeTerminalInputEcho('codex\r', 'cod'), { expected: 'ex\n', response: '' });
  assert.deepEqual(consumeTerminalInputEcho('ex\r', 'ex\r\n'), { expected: '', response: '' });
  assert.deepEqual(consumeTerminalInputEcho('ls\r', 'ls\r\nresult.txt\r\n'), {
    expected: '',
    response: 'result.txt\n'
  });
  assert.deepEqual(consumeTerminalInputEcho('x', 'unrelated output'), {
    expected: '',
    response: 'unrelated output'
  });
});

test('GitHub pull request URLs are captured across terminal output chunks', () => {
  const first = scanTerminalUrls('', 'Review https://github.com/Andorra-Labs/Andorra-Labs-Alpha/pu');
  assert.deepEqual(first.urls, []);
  const second = scanTerminalUrls(first.buffer, 'll/684 before merging\n');
  assert.deepEqual(second.urls, ['https://github.com/Andorra-Labs/Andorra-Labs-Alpha/pull/684']);
});

test('URL capture keeps only canonical GitHub pull requests', () => {
  const result = scanTerminalUrls('', [
    'https://github.com/Andorra-Labs/Andorra-Labs-Alpha/issues/12',
    'https://docs.example.com/setup',
    'https://github.com/hyudryu/SideTerm/pull/2/files?diff=split#discussion_r1'
  ].join(' '));
  assert.deepEqual(result.urls, ['https://github.com/hyudryu/SideTerm/pull/2']);
  assert.equal(normalizeGithubPullRequestUrl('https://example.com/a/b/pull/2'), null);
});

test('restored history remains pending AI context until summarized', () => {
  assert.deepEqual(restoredContextState('old terminal context', false), {
    context: 'old terminal context', contextRevision: 1, lastSummarizedRevision: 0
  });
  assert.deepEqual(restoredContextState('already summarized', true), {
    context: 'already summarized', contextRevision: 1, lastSummarizedRevision: 1
  });
});

test('coding-agent work indicators keep an armed session busy through quiet output gaps', () => {
  const codex = '• Working (34s • esc to interrupt)';
  const claude = 'Thinking (2m 4s · ctrl+c to interrupt)';
  const hermes = '⚕ deepseek-v4-flash │ 135K/1M │ 23m │ ⏱ 4m 9s\n⚕ ❯ msg=interrupt · /queue · Ctrl+C cancel';

  assert.equal(isAgentWorkingText(codex), true);
  assert.equal(isAgentWorkingText(claude), true);
  assert.equal(isAgentWorkingText(hermes), true);
  assert.equal(shouldKeepSessionBusy(true, codex), true);
  assert.equal(shouldKeepSessionBusy(false, codex), false);
});

test('an idle coding-agent prompt does not keep the spinner active', () => {
  const idle = '› Write tests for @filename\n\ngpt-5.6-sol high · ~/Andorra-Labs-Alpha';
  const idleHermes = '⚕ deepseek-v4-flash │ 104K/1M │ ⏲ 9m 27s │ ✓ 59s\n❯';
  assert.equal(isAgentWorkingText(idle), false);
  assert.equal(isAgentWorkingText(idleHermes), false);
  assert.equal(shouldKeepSessionBusy(true, idle), false);
});

test('a newer idle prompt overrides stale working status in the visible window', () => {
  const interruptedCodex = '• Working (34s • esc to interrupt)\n^C\nmark@ubuntu:~/repo$';
  const completedHermes = '⚕ model │ ⏱ 4m 9s\n⚕ ❯ msg=interrupt · Ctrl+C cancel\n⚕ model │ ⏲ 4m 12s │ ✓ 3s\n❯';

  assert.equal(agentActivityState(interruptedCodex), 'idle');
  assert.equal(agentActivityState(completedHermes), 'idle');
  assert.equal(shouldKeepSessionBusy(true, interruptedCodex), false);
  assert.equal(shouldKeepSessionBusy(true, completedHermes), false);
});

test('terminal status scanning follows the cursor instead of trailing blank viewport rows', () => {
  assert.deepEqual(terminalStatusRowRange({ bufferLength: 30, baseY: 0, cursorY: 4, screenRows: 30 }), { start: 0, end: 7 });
  assert.deepEqual(terminalStatusRowRange({ bufferLength: 80, baseY: 50, cursorY: 28, screenRows: 30 }), { start: 67, end: 80 });
});

test('an unread bell notification cannot be auto-armed into a new activity cycle', () => {
  assert.equal(canAutoArmAgentActivity(false, false, true), true);
  assert.equal(canAutoArmAgentActivity(false, true, true), false);
});
