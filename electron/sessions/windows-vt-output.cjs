const ESC = '\u001b';
const CP437_ESCAPE = '\u2190';
const KIMI_SYNC_OUTPUT_SENTINEL = `${CP437_ESCAPE}[?2026h`;
const DEFAULT_PENDING_DELAY_MS = 25;

function shouldRepairWindowsVtOutput(value) {
  return String(value || '').includes(KIMI_SYNC_OUTPUT_SENTINEL);
}

function repairWindowsVtOutput(value) {
  return String(value || '').replace(/\u2190(?=[\[\]PX^_\\78=>cDEHMNOZ()*+\-./%#])/g, ESC);
}

function sentinelPrefixLength(value) {
  const text = String(value || '');
  const limit = Math.min(text.length, KIMI_SYNC_OUTPUT_SENTINEL.length - 1);
  for (let length = limit; length > 0; length -= 1) {
    if (text.endsWith(KIMI_SYNC_OUTPUT_SENTINEL.slice(0, length))) return length;
  }
  return 0;
}

function createWindowsVtOutputNormalizer({
  enabled = process.platform === 'win32',
  onOutput = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pendingDelayMs = DEFAULT_PENDING_DELAY_MS
} = {}) {
  let repairing = false;
  let pending = '';
  let pendingTimer = null;

  function cancelPendingTimer() {
    if (pendingTimer === null) return;
    clearTimer(pendingTimer);
    pendingTimer = null;
  }

  function schedulePendingRelease() {
    cancelPendingTimer();
    pendingTimer = setTimer(() => {
      pendingTimer = null;
      const output = pending;
      pending = '';
      if (output) onOutput(output);
    }, pendingDelayMs);
  }

  return {
    push(value) {
      let text = String(value || '');
      if (!enabled) return text;

      cancelPendingTimer();
      text = `${pending}${text}`;
      pending = '';

      if (!repairing) {
        if (shouldRepairWindowsVtOutput(text)) {
          repairing = true;
          return repairWindowsVtOutput(text);
        }
        const prefixLength = sentinelPrefixLength(text);
        if (!prefixLength) return text;
        pending = text.slice(-prefixLength);
        schedulePendingRelease();
        return text.slice(0, -prefixLength);
      }

      if (text.endsWith(CP437_ESCAPE)) {
        pending = CP437_ESCAPE;
        text = text.slice(0, -CP437_ESCAPE.length);
        schedulePendingRelease();
      }
      return repairWindowsVtOutput(text);
    },

    flush() {
      cancelPendingTimer();
      const output = pending;
      pending = '';
      return output;
    },

    dispose() {
      cancelPendingTimer();
      pending = '';
    },

    get repairing() {
      return repairing;
    },

    get hasPending() {
      return Boolean(pending);
    }
  };
}

function createReplayAwareWindowsVtOutputNormalizer({ onOutput = () => {}, ...options } = {}) {
  let pendingReplay = null;
  const replayMetadata = (replay) => replay ? {
    claimToken: replay.claimToken,
    hostGeneration: replay.hostGeneration,
    outputRevision: replay.outputRevision
  } : {};
  const normalizer = createWindowsVtOutputNormalizer({
    ...options,
    onOutput: (data) => {
      const replay = pendingReplay;
      pendingReplay = null;
      onOutput(`${replay?.data || ''}${data}`, replayMetadata(replay));
    }
  });

  return {
    push(value, replay = null) {
      const carriedReplay = replay?.claimToken ? replay : pendingReplay;
      const bufferedReplayData = pendingReplay?.data || '';
      const output = normalizer.push(value);
      if (carriedReplay && normalizer.hasPending) {
        pendingReplay = { ...carriedReplay, data: `${bufferedReplayData}${output}` };
        return;
      }
      pendingReplay = null;
      onOutput(`${bufferedReplayData}${output}`, replayMetadata(carriedReplay));
    },

    flush() {
      const replay = pendingReplay;
      pendingReplay = null;
      const output = `${replay?.data || ''}${normalizer.flush()}`;
      if (output || replay?.claimToken) onOutput(output, replayMetadata(replay));
    },

    dispose() {
      pendingReplay = null;
      normalizer.dispose();
    }
  };
}

module.exports = {
  createReplayAwareWindowsVtOutputNormalizer,
  createWindowsVtOutputNormalizer,
  repairWindowsVtOutput,
  sentinelPrefixLength,
  shouldRepairWindowsVtOutput
};
