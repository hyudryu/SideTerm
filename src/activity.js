export function isBareAgentLaunchCommand(command) {
  const value = String(command).trim();
  return /^(?:(?:sudo|env)\s+)*(?:\S*\/)?(?:codex|claude|hermes|gemini)(?:\s+--?[^\s]+)*$/i.test(value);
}

export function terminalWheelAmount({ ctrlKey, deltaY }) {
  if (ctrlKey || !Number.isFinite(deltaY) || deltaY === 0) return null;
  const lineCount = Math.max(1, Math.min(12, Math.round(Math.abs(deltaY) / 36)));
  return deltaY < 0 ? -lineCount : lineCount;
}

export function stripTerminalControlInput(value) {
  return String(value)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_].*?(?:\x1B\\|$)/gs, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1BO./g, '')
    .replace(/\x1B./g, '');
}

function normalizeTerminalEcho(value) {
  return String(value).replace(/\r\n|\r/g, '\n');
}

export function consumeTerminalInputEcho(expectedInput, output) {
  const expected = normalizeTerminalEcho(expectedInput);
  const received = normalizeTerminalEcho(output);
  if (!expected || !received) return { expected, response: received };
  if (expected.startsWith(received)) {
    return { expected: expected.slice(received.length), response: '' };
  }
  if (received.startsWith(expected)) {
    return { expected: '', response: received.slice(expected.length) };
  }
  return { expected: '', response: received };
}

export function normalizeGithubPullRequestUrl(value) {
  try {
    const parsed = new URL(String(value).replace(/[),.;:!?]+$/, ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'github.com') return null;
    const match = parsed.pathname.match(/^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)(?:\/.*)?$/i);
    if (!match) return null;
    return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
  } catch {
    return null;
  }
}

export function scanTerminalUrls(previousBuffer, chunk) {
  const buffer = `${previousBuffer || ''}${chunk || ''}`.slice(-4096);
  const urls = new Set();

  for (const match of buffer.matchAll(/https?:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+(?:\/[^\s<>"'`]*)?/gi)) {
    const normalized = normalizeGithubPullRequestUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return { buffer, urls: [...urls] };
}

export function restoredContextState(history, hasSummary, maxCharacters = 16_000) {
  const context = String(history || '').slice(-Math.max(1, maxCharacters));
  const contextRevision = context.trim() ? 1 : 0;
  return {
    context,
    contextRevision,
    lastSummarizedRevision: hasSummary ? contextRevision : 0
  };
}

function lastMatchIndex(text, patterns) {
  let latest = -1;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) latest = Math.max(latest, match.index || 0);
  }
  return latest;
}

export function agentActivityState(value) {
  const text = String(value);
  const workingIndex = lastMatchIndex(text, [
    /(?:working|thinking|running|processing)\s*\([^\n)]*(?:esc|ctrl\s*\+\s*c)\s+to\s+interrupt[^\n)]*\)/giu,
    /⏱\s*\d+(?:m|s|h)[\s\S]{0,400}?(?:msg=interrupt|ctrl\s*\+\s*c\s+cancel)/giu
  ]);
  const idleIndex = lastMatchIndex(text, [
    /^[^\n]*[│|]\s*✓\s*\d[^\n]*$/gmu,
    /^\s*[❯>]\s*$/gmu,
    /^(?:[^\n]*@[^:\n]+:[^\n]*[$#]|[$#])\s*$/gmu
  ]);
  if (idleIndex > workingIndex) return 'idle';
  if (workingIndex >= 0) return 'working';
  return 'unknown';
}

export function isAgentWorkingText(value) {
  return agentActivityState(value) === 'working';
}

export function shouldKeepSessionBusy(activityArmed, visibleTerminalText) {
  return Boolean(activityArmed && isAgentWorkingText(visibleTerminalText));
}

export function canAutoArmAgentActivity(activityArmed, notified, agentIsWorking) {
  return Boolean(!activityArmed && !notified && agentIsWorking);
}

export function terminalStatusRowRange({ bufferLength, baseY, cursorY, screenRows }) {
  const length = Math.max(0, Number(bufferLength) || 0);
  if (!length) return { start: 0, end: 0 };
  const firstScreenRow = Math.max(0, Number(baseY) || 0);
  const rows = Math.max(1, Number(screenRows) || 1);
  const cursor = Math.max(firstScreenRow, Math.min(length - 1, firstScreenRow + Math.max(0, Number(cursorY) || 0)));
  return {
    start: Math.max(firstScreenRow, cursor - 11),
    end: Math.min(length, cursor + 3, firstScreenRow + rows)
  };
}
