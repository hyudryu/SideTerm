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

export function scanTerminalUrls(previousBuffer, chunk) {
  const buffer = `${previousBuffer || ''}${chunk || ''}`.slice(-4096);
  const urls = new Set();
  const addUrl = (value, githubPullRequest = false) => {
    try {
      const parsed = new URL(value.replace(/[),.;:!?]+$/, ''));
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      if (parsed.hostname.toLowerCase() === 'github.com') {
        if (!githubPullRequest) return;
        parsed.search = '';
        parsed.hash = '';
      }
      urls.add(parsed.toString());
    } catch {
      // A future output chunk may complete a currently partial URL.
    }
  };

  for (const match of buffer.matchAll(/https?:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/gi)) {
    addUrl(match[0], true);
  }
  for (const match of buffer.matchAll(/https?:\/\/[^\s<>"'`]+/g)) addUrl(match[0]);
  return { buffer, urls: [...urls] };
}
