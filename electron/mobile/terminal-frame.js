(function exposeTerminalFrames(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SideTermTerminalFrames = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function terminalFrameText(value) {
    return String(value || '').replace(/\r?\n/g, '\r\n');
  }

  class TerminalFrameWriter {
    constructor({ reset, write, scrollToBottom }) {
      this.reset = reset;
      this.write = write;
      this.scrollToBottom = scrollToBottom;
      this.sessionId = null;
      this.generation = 0;
      this.pending = null;
      this.writing = false;
    }

    select(sessionId, placeholder = '') {
      this.sessionId = sessionId;
      this.generation += 1;
      this.pending = { generation: this.generation, text: terminalFrameText(placeholder) };
      this.drain();
    }

    render(sessionId, value) {
      if (!sessionId || sessionId !== this.sessionId) return false;
      this.pending = { generation: this.generation, text: terminalFrameText(value) };
      this.drain();
      return true;
    }

    drain() {
      if (this.writing || !this.pending) return;
      const frame = this.pending;
      this.pending = null;
      this.writing = true;
      this.reset();
      this.write(frame.text, () => {
        this.writing = false;
        if (this.pending) {
          this.drain();
          return;
        }
        if (frame.generation === this.generation) this.scrollToBottom();
      });
    }
  }

  return { TerminalFrameWriter, terminalFrameText };
}));
