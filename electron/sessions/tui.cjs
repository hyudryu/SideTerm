const NAMED_KEYS = Object.freeze({
  UP: '\u001b[A', DOWN: '\u001b[B', LEFT: '\u001b[D', RIGHT: '\u001b[C', ENTER: '\r', TAB: '\t',
  SPACE: ' ', ESC: '\u001b', BACKSPACE: '\u007f', CTRL_C: '\u0003', CTRL_D: '\u0004'
});

function cleanTerminalText(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

function tuiSnapshot(value, terminalId = '') {
  const text = cleanTerminalText(value).slice(-20_000);
  const options = [];
  let selectedIndex = -1;
  for (const line of text.split('\n').slice(-80)) {
    const match = line.match(/^\s*([>❯›]|\(\s*[xX ]?\s*\)|\[\s*[xX ]?\s*\]|\d+[.)])\s+(.{1,300})$/u);
    if (!match) continue;
    const index = options.length;
    const selected = /^[>❯›]$/u.test(match[1]) || /[xX]/.test(match[1]);
    if (selected) selectedIndex = index;
    options.push({ index, label: match[2].trim(), selected });
  }
  const confidence = options.length >= 2 ? (selectedIndex >= 0 ? 0.98 : 0.82) : 0;
  return { terminalId: String(terminalId), text, selectedIndex, options, confidence };
}

function canSubmitTuiKey(snapshot, key) {
  const normalized = String(key || '').toUpperCase();
  return Object.hasOwn(NAMED_KEYS, normalized)
    && Boolean(snapshot && snapshot.confidence >= 0.8 && snapshot.selectedIndex >= 0);
}

function selectionKeys(snapshot, targetIndex) {
  if (!snapshot || snapshot.confidence < 0.8 || snapshot.selectedIndex < 0) throw new Error('The terminal menu is not reliable enough to control.');
  const target = Math.floor(Number(targetIndex));
  if (target < 0 || target >= snapshot.options.length) throw new Error('The requested TUI option does not exist.');
  const direction = target >= snapshot.selectedIndex ? 'DOWN' : 'UP';
  return [...Array(Math.abs(target - snapshot.selectedIndex)).fill(direction), 'ENTER'];
}

function namedKeyData(key) {
  const normalized = String(key || '').toUpperCase();
  if (!Object.hasOwn(NAMED_KEYS, normalized)) throw new Error(`Unsupported terminal key: ${key}`);
  return NAMED_KEYS[normalized];
}

module.exports = { NAMED_KEYS, canSubmitTuiKey, cleanTerminalText, namedKeyData, selectionKeys, tuiSnapshot };
