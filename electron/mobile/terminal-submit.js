(function exposeMobileTerminalSubmit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SideTermMobileSubmit = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function submitTerminalInput({ value, send, setTimer = setTimeout, submitDelayMs = 75 } = {}) {
    if (typeof send !== 'function') return false;
    const text = String(value || '');
    if (!text) return send('\r');
    if (!send(text)) return false;
    setTimer(() => send('\r'), submitDelayMs);
    return true;
  }

  return { submitTerminalInput };
}));
