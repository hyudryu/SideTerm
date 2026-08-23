// Helpers for reporting speech component install progress.

// Parses pip's `--progress-bar raw` output ("Progress X of Y") into a percent.
function parsePipProgress(text) {
  const match = /Progress (\d+) of (\d+)/.exec(String(text));
  if (!match) return null;
  const total = Number(match[2]);
  if (!total) return null;
  return Math.min(100, Math.round((Number(match[1]) / total) * 100));
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1e3))} KB`;
}

module.exports = { formatBytes, parsePipProgress };
