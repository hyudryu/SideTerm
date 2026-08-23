export function isVoiceShortcutBypassActive(deadline, now = Date.now()) {
  const expiresAt = Number(deadline) || 0;
  return expiresAt > 0 && Number(now) <= expiresAt;
}
