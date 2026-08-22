class SentenceBuffer {
  constructor(onSentence) {
    this.buffer = '';
    this.onSentence = onSentence || (() => {});
  }

  push(delta) {
    this.buffer += String(delta || '');
    const emitted = [];
    for (;;) {
      const match = this.buffer.match(/^([\s\S]*?[.!?])(?:\s+|$)/);
      if (!match) break;
      const sentence = match[1].trim();
      this.buffer = this.buffer.slice(match[0].length);
      if (sentence) {
        emitted.push(sentence);
        this.onSentence(sentence);
      }
    }
    return emitted;
  }

  flush() {
    const sentence = this.buffer.trim();
    this.buffer = '';
    if (sentence && sentence !== 'NEEDS_ENRICHMENT') this.onSentence(sentence);
    return sentence && sentence !== 'NEEDS_ENRICHMENT' ? sentence : '';
  }
}

module.exports = { SentenceBuffer };
