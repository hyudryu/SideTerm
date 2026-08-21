export const MAX_AI_SUMMARY_FAILURES = 3;

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
