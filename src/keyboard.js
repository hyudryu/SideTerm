export function resolveTerminalShortcut(event, hasSelection) {
  if (!event.ctrlKey || event.altKey) return null;

  const key = event.key.toLowerCase();
  if (key === 'c' && !event.shiftKey) {
    return hasSelection ? 'copy' : 'terminal-input';
  }
  if (key === 'v') return 'paste';
  if (key === 'c' && event.shiftKey) return hasSelection ? 'copy' : 'handled';
  if (key === 't' && event.shiftKey) return 'new-session';
  if (key === 'w' && event.shiftKey) return 'close-session';
  if (key === 'b' && event.shiftKey) return 'toggle-sidebar';
  if (key === 'tab') return event.shiftKey ? 'previous-session' : 'next-session';
  return null;
}
