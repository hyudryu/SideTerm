export function isBareAgentLaunchCommand(command) {
  const value = String(command).trim();
  return /^(?:(?:sudo|env)\s+)*(?:\S*\/)?(?:codex|claude|hermes|gemini)(?:\s+--?[^\s]+)*$/i.test(value);
}

export function terminalWheelAmount({ ctrlKey, deltaY }) {
  if (ctrlKey || !Number.isFinite(deltaY) || deltaY === 0) return null;
  const lineCount = Math.max(1, Math.min(12, Math.round(Math.abs(deltaY) / 36)));
  return deltaY < 0 ? -lineCount : lineCount;
}
