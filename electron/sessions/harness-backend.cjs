class DeepSeekHarnessBackend {
  constructor(bridge) {
    if (!bridge) throw new Error('DeepSeek Harness backend requires a bridge client.');
    this.bridge = bridge;
  }

  listSessions() { return this.bridge.request('agents.list', {}); }
  getSession(id) { return this.bridge.request('agents.get', { id }); }

  sendInstruction(id, message, mode = 'auto') {
    const requested = String(mode);
    const delivery = requested === 'steer' || requested === 'inject' ? requested : 'followup';
    return this.bridge.request(`agents.${delivery}`, { id: String(id), message: String(message) });
  }

  readTerminal(id) { return this.bridge.request('terminal.snapshot', { id: String(id) }); }
  sendKey(id, key) { return this.bridge.request('terminal.keypress', { id: String(id), key: String(key) }); }
  subscribe(handler) { return this.bridge.subscribe('session/event', handler); }
}

module.exports = { DeepSeekHarnessBackend };
