const ESC = '\u001b';
const CP437_ESCAPE = '\u2190';
const KIMI_SYNC_OUTPUT_SENTINEL = `${CP437_ESCAPE}[?2026h`;
const PROBE_LIMIT = 512;

function brokenAnsiSequenceCount(value) {
  return (String(value || '').match(/\u2190(?:\[[0-?]+[ -/]*[@-~]|\](?:\d{1,4};|8;;))/g) || []).length;
}

function shouldRepairWindowsVtOutput(value) {
  const text = String(value || '');
  return text.includes(KIMI_SYNC_OUTPUT_SENTINEL) || brokenAnsiSequenceCount(text) >= 3;
}

function repairWindowsVtOutput(value) {
  return String(value || '').replace(/\u2190(?=[\[\]P^_\\])/g, ESC);
}

function createWindowsVtOutputNormalizer({ enabled = process.platform === 'win32' } = {}) {
  let probe = '';
  let repairing = false;
  let pendingArrow = '';

  return {
    push(value) {
      let text = String(value || '');
      if (!enabled) return text;

      text = `${pendingArrow}${text}`;
      pendingArrow = '';
      if (text.endsWith(CP437_ESCAPE)) {
        pendingArrow = CP437_ESCAPE;
        text = text.slice(0, -CP437_ESCAPE.length);
      }

      probe = `${probe}${text}`.slice(-PROBE_LIMIT);
      if (!repairing && shouldRepairWindowsVtOutput(probe)) repairing = true;
      return repairing ? repairWindowsVtOutput(text) : text;
    },

    flush() {
      const text = pendingArrow;
      pendingArrow = '';
      return text;
    },

    get repairing() {
      return repairing;
    }
  };
}

module.exports = {
  brokenAnsiSequenceCount,
  createWindowsVtOutputNormalizer,
  repairWindowsVtOutput,
  shouldRepairWindowsVtOutput
};
