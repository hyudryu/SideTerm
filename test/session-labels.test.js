import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDisplayLabels } from '../src/session-labels.js';

test('AI naming uses the generated name as the session title', () => {
  assert.deepEqual(sessionDisplayLabels({
    title: 'mark@ubuntu: ~/Native-GPT',
    manualTitle: false,
    agent: 'Codex',
    displayName: 'Upscale Workflow',
    summary: 'Wiring and testing image upscaling'
  }, true), {
    aiLabelActive: true,
    primary: 'Upscale Workflow',
    secondary: 'Wiring and testing image upscaling'
  });
});

test('legacy generic AI names promote the useful context instead of showing only Codex', () => {
  assert.deepEqual(sessionDisplayLabels({
    title: 'Terminal 13',
    manualTitle: false,
    agent: 'Codex',
    displayName: 'Codex',
    summary: 'Wiring and testing upscale workflow'
  }, true), {
    aiLabelActive: true,
    primary: 'Wiring and testing upscale workflow',
    secondary: 'Codex'
  });
});
