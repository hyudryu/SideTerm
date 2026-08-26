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
      this.pendingAppend = '';
      this.writing = false;
      this.preservedViewport = null;
    }

    select(sessionId, placeholder = '') {
      this.sessionId = sessionId;
      this.generation += 1;
      this.preservedViewport = null;
      this.pendingAppend = '';
      this.pending = { generation: this.generation, text: terminalFrameText(placeholder), preserveViewport: false };
      this.drain();
    }

    render(sessionId, value) {
      if (!sessionId || sessionId !== this.sessionId) return false;
      this.pendingAppend = '';
      this.pending = { generation: this.generation, text: terminalFrameText(value), preserveViewport: true };
      this.drain();
      return true;
    }

    append(sessionId, value) {
      if (!sessionId || sessionId !== this.sessionId) return false;
      this.pendingAppend += String(value || '');
      this.drain();
      return true;
    }

    drain() {
      if (this.writing) return;
      if (!this.pending && this.pendingAppend) {
        const generation = this.generation;
        const text = this.pendingAppend;
        this.pendingAppend = '';
        this.writing = true;
        this.write(text, () => {
          this.writing = false;
          if (generation !== this.generation) return this.drain();
          this.drain();
        });
        return;
      }
      if (!this.pending) return;
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
        if (frame.generation === this.generation) {
          if (viewport && !viewport.atBottom && this.restoreViewport) this.restoreViewport(viewport);
          else this.scrollToBottom();
        }
        this.drain();
      });
    }
  }

  return { TerminalFrameWriter, terminalFrameText };
}));
