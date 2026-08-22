const fs = require('node:fs');
const path = require('node:path');

function formatDetail(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createLogger({ filePath, maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!filePath) throw new Error('Logger requires a file path.');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Writes are synchronous on purpose: a message queued right before the main
  // process blocks must already be on disk, not stuck in a libuv queue.
  function write(level, message, details) {
    const suffix = details === undefined ? '' : ` ${formatDetail(details)}`;
    const line = `${new Date().toISOString()} [${level}] ${message}${suffix}\n`;
    try {
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      if (size + line.length > maxBytes) {
        try { fs.rmSync(`${filePath}.1`, { force: true }); } catch {}
        try { fs.renameSync(filePath, `${filePath}.1`); } catch {}
      }
      fs.appendFileSync(filePath, line);
    } catch {}
  }

  return {
    filePath,
    info: (message, details) => write('INFO', message, details),
    warn: (message, details) => write('WARN', message, details),
    error: (message, details) => write('ERROR', message, details)
  };
}

// Detects main-process freezes by measuring timer drift: when the event loop
// is blocked, the interval fires late and the overshoot is the blockage length.
function createEventLoopLagMonitor({
  intervalMs = 2000,
  warnThresholdMs = 500,
  onLag,
  setTimer = setInterval,
  clearTimer = clearInterval,
  now = Date.now
} = {}) {
  if (typeof onLag !== 'function') throw new Error('Lag monitor requires an onLag callback.');
  let timer = null;
  let expected = 0;

  function start() {
    if (timer) return;
    expected = now() + intervalMs;
    timer = setTimer(() => {
      const current = now();
      const lagMs = current - expected;
      expected = current + intervalMs;
      if (lagMs >= warnThresholdMs) onLag(lagMs);
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  }

  return { start, stop, isRunning: () => Boolean(timer) };
}

module.exports = { createEventLoopLagMonitor, createLogger };
