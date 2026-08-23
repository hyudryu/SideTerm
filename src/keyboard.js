export const DEFAULT_HOTKEYS = {
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  newSession: 'Ctrl+Shift+T',
  closeSession: 'Ctrl+Shift+W',
  toggleSidebar: 'Ctrl+Shift+B',
  nextSession: 'Ctrl+Tab',
  previousSession: 'Ctrl+Shift+Tab',
  openSettings: 'Ctrl+,',
  voiceActivation: 'Ctrl+Shift+A'
};

const ACTIONS = {
  copy: 'copy',
  paste: 'paste',
  newSession: 'new-session',
  closeSession: 'close-session',
  toggleSidebar: 'toggle-sidebar',
  nextSession: 'next-session',
  previousSession: 'previous-session',
  openSettings: 'open-settings',
  voiceActivation: 'voice-activation'
};

export function keyboardEventToAccelerator(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  let key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return '';
  if (key === ' ') key = 'Space';
  else if (key.length === 1 && /[a-z]/i.test(key)) key = key.toUpperCase();
  else if (key.length > 1) key = `${key[0].toUpperCase()}${key.slice(1)}`;
  parts.push(key);
  return parts.join('+');
}

export function resolveTerminalShortcut(event, hasSelection, bindings = DEFAULT_HOTKEYS) {
  const accelerator = keyboardEventToAccelerator(event);
  if (!accelerator) return null;
  const hotkeys = { ...DEFAULT_HOTKEYS, ...bindings };

  for (const [setting, action] of Object.entries(ACTIONS)) {
    if (accelerator !== hotkeys[setting]) continue;
    if (setting === 'copy') {
      return hasSelection ? 'copy' : accelerator === 'Ctrl+C' ? 'terminal-input' : 'handled';
    }
    return action;
  }

  // Keep the familiar terminal variants in addition to Windows-style defaults.
  if (hotkeys.copy === 'Ctrl+C' && accelerator === 'Ctrl+Shift+C') return hasSelection ? 'copy' : 'handled';
  if (hotkeys.paste === 'Ctrl+V' && accelerator === 'Ctrl+Shift+V') return 'paste';
  return null;
}

export function consumeTerminalShortcutEvent(event, action) {
  if (!action || action === 'terminal-input') return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
