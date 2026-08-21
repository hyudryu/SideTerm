import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_SESSION_STALE_MS, aiSummaryRetryDelay, isAiSessionStale, MAX_AI_SUMMARY_FAILURES, shouldBackfillAiSessionLabel, shouldPauseStaleAiSummary, shouldRearmAiSummary } from '../src/ai-summary.js';

test('sessions become stale after five minutes without context activity', () => {
  const now = 1_000_000;
  assert.equal(isAiSessionStale(0, now), false);
  assert.equal(isAiSessionStale(now - AI_SESSION_STALE_MS + 1, now), false);
  assert.equal(isAiSessionStale(now - AI_SESSION_STALE_MS, now), true);
  assert.equal(isAiSessionStale(now - AI_SESSION_STALE_MS - 1, now), true);
});

test('a stale session pauses only after its final context update', () => {
  const now = 1_000_000;
  const staleActivity = now - AI_SESSION_STALE_MS;
  assert.equal(shouldPauseStaleAiSummary(false, staleActivity, now), false);
  assert.equal(shouldPauseStaleAiSummary(true, staleActivity, now), true);
  assert.equal(shouldPauseStaleAiSummary(true, now, now), false);
});

test('continuous context backfills sessions that never received an AI label', () => {
  assert.equal(shouldBackfillAiSessionLabel('', false, true), true);
  assert.equal(shouldBackfillAiSessionLabel('', true, false), true);
  assert.equal(shouldBackfillAiSessionLabel('', false, false), false);
  assert.equal(shouldBackfillAiSessionLabel('Existing context', true, true), false);
});

test('AI summary retries back off and stop after a bounded failure count', () => {
  assert.equal(aiSummaryRetryDelay(1, { baseDelayMs: 30_000 }), 30_000);
  assert.equal(aiSummaryRetryDelay(2, { baseDelayMs: 30_000 }), 60_000);
  assert.equal(aiSummaryRetryDelay(MAX_AI_SUMMARY_FAILURES, { baseDelayMs: 30_000 }), null);
});

test('AI summary retry honors a longer provider cooldown', () => {
  assert.equal(aiSummaryRetryDelay(1, { baseDelayMs: 30_000, cooldownDelayMs: 300_000 }), 300_000);
});

test('new context re-arms a summary stopped at its failure budget', () => {
  assert.equal(shouldRearmAiSummary(MAX_AI_SUMMARY_FAILURES, 12, 12), false);
  assert.equal(shouldRearmAiSummary(MAX_AI_SUMMARY_FAILURES, 12, 13), true);
  assert.equal(shouldRearmAiSummary(MAX_AI_SUMMARY_FAILURES - 1, 12, 13), false);
});
