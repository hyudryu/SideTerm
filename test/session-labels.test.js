import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLastResponseAge, sessionDisplayLabels } from '../src/session-labels.js';

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

test('last response ages use compact seconds, minutes, hours, and days', () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  assert.equal(compactLastResponseAge(0, now), '');
  assert.equal(compactLastResponseAge(Number.POSITIVE_INFINITY, now), '');
  assert.equal(compactLastResponseAge(now - 5_000, now), '5s');
  assert.equal(compactLastResponseAge(now - 59_999, now), '59s');
  assert.equal(compactLastResponseAge(now - 60_000, now), '1m');
  assert.equal(compactLastResponseAge(now - 3_599_999, now), '59m');
  assert.equal(compactLastResponseAge(now - 3_600_000, now), '1h');
  assert.equal(compactLastResponseAge(now - 86_400_000, now), '1d');
  assert.equal(compactLastResponseAge(now + 5_000, now), '0s');
});
