(function exposeTerminalFrames(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SideTermTerminalFrames = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function terminalFrameText(value) {
    return String(value || '').replace(/\r?\n/g, '\r\n');
  }

  class TerminalFrameWriter {
    constructor({ reset, write, scrollToBottom, captureViewport = null, restoreViewport = null }) {
      this.reset = reset;
      this.write = write;
      this.scrollToBottom = scrollToBottom;
      this.captureViewport = captureViewport;
      this.restoreViewport = restoreViewport;
      this.sessionId = null;
      this.generation = 0;
      this.pending = null;
      this.writing = false;
      this.preservedViewport = null;
    }

    select(sessionId, placeholder = '') {
      this.sessionId = sessionId;
      this.generation += 1;
      this.preservedViewport = null;
      this.pending = { generation: this.generation, text: terminalFrameText(placeholder), preserveViewport: false };
      this.drain();
    }

    render(sessionId, value) {
      if (!sessionId || sessionId !== this.sessionId) return false;
      this.pending = { generation: this.generation, text: terminalFrameText(value), preserveViewport: true };
      this.drain();
      return true;
    }

    drain() {
      if (this.writing || !this.pending) return;
      const frame = this.pending;
      this.pending = null;
      this.writing = true;
      const viewport = frame.preserveViewport ? (this.preservedViewport || this.captureViewport?.()) : null;
      if (viewport) this.preservedViewport = viewport;
      this.reset();
      this.write(frame.text, () => {
        this.writing = false;
        if (this.pending) {
          this.drain();
          return;
        }
        this.preservedViewport = null;
        if (frame.generation !== this.generation) return;
        if (viewport && !viewport.atBottom && this.restoreViewport) this.restoreViewport(viewport);
        else this.scrollToBottom();
      });
    }
  }

  return { TerminalFrameWriter, terminalFrameText };
}));
