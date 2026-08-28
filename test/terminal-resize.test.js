import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefitTerminal, TERMINAL_GROW_REFIT_THRESHOLD_PX } from '../src/terminal-resize.js';

test('terminal refits immediately when the sidebar expands by one pixel', () => {
  assert.equal(shouldRefitTerminal(
    { width: 900, height: 600 },
    { width: 900, height: 600 },
    { width: 899, height: 600 }
  ), true);
});

test('sidebar expansion refits after ignored shrink space remains', () => {
  assert.equal(shouldRefitTerminal(
    { width: 900, height: 600 },
    { width: 919, height: 600 },
    { width: 918, height: 600 }
  ), true);
});

test('terminal ignores width gained below the sidebar shrink threshold', () => {
  assert.equal(shouldRefitTerminal(
    { width: 900, height: 600 },
    { width: 918, height: 600 },
    { width: 900 + TERMINAL_GROW_REFIT_THRESHOLD_PX - 1, height: 600 }
  ), false);
});

test('terminal refits once cumulative gained width reaches the sidebar shrink threshold', () => {
  assert.equal(shouldRefitTerminal(
    { width: 900, height: 600 },
    { width: 900 + TERMINAL_GROW_REFIT_THRESHOLD_PX - 1, height: 600 },
    { width: 900 + TERMINAL_GROW_REFIT_THRESHOLD_PX, height: 600 }
  ), true);
});

test('terminal refits for vertical changes and initial measurements', () => {
  assert.equal(shouldRefitTerminal(
    { width: 900, height: 600 },
    { width: 900, height: 600 },
    { width: 900, height: 599 }
  ), true);
  assert.equal(shouldRefitTerminal(null, null, { width: 900, height: 600 }), true);
});
