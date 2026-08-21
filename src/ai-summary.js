export const MAX_AI_SUMMARY_FAILURES = 3;
export const AI_SESSION_STALE_MS = 5 * 60_000;

export function isAiSessionStale(lastActivityAt, now = Date.now(), staleAfterMs = AI_SESSION_STALE_MS) {
  const activityAt = Number(lastActivityAt);
  const currentTime = Number(now);
  const threshold = Math.max(1, Number(staleAfterMs) || AI_SESSION_STALE_MS);
  return Number.isFinite(activityAt)
    && activityAt > 0
    && Number.isFinite(currentTime)
    && currentTime - activityAt >= threshold;
}

export function shouldPauseStaleAiSummary(staleSummaryDone, lastActivityAt, now = Date.now()) {
  return Boolean(staleSummaryDone && isAiSessionStale(lastActivityAt, now));
}

export function shouldBackfillAiSessionLabel(summary, initialEnabled, continuousEnabled) {
  return Boolean(!String(summary || '').trim() && (initialEnabled || continuousEnabled));
}

export function shouldRearmAiSummary(failureCount, failureRevision, contextRevision, maxFailures = MAX_AI_SUMMARY_FAILURES) {
  return Number(failureCount) >= maxFailures && Number(failureRevision) !== Number(contextRevision);
}

export function aiSummaryRetryDelay(failureCount, {
  baseDelayMs,
  cooldownDelayMs = 0,
  maxFailures = MAX_AI_SUMMARY_FAILURES
} = {}) {
  const failures = Math.max(0, Math.floor(Number(failureCount) || 0));
  if (failures >= maxFailures) return null;
  const base = Math.max(1, Number(baseDelayMs) || 1);
  const exponential = base * (2 ** Math.max(0, failures - 1));
  return Math.max(exponential, Math.max(0, Number(cooldownDelayMs) || 0));
}
