class HarnessBridgeClient {
  constructor(options = {}) {
    this.endpoint = new URL(options.endpoint || 'http://127.0.0.1:43111');
    if (!['127.0.0.1', '::1', 'localhost'].includes(this.endpoint.hostname)) throw new Error('Harness bridge must use a loopback endpoint.');
    if (this.endpoint.protocol !== 'http:') throw new Error('Harness bridge must use loopback HTTP.');
    this.token = String(options.token || '');
    if (this.token.length < 24) throw new Error('Harness bridge token must contain at least 24 characters.');
  }

  url(pathname) {
    return new URL(pathname, this.endpoint).toString();
  }

  async request(method, input = {}) {
    const response = await fetch(this.url('/rpc'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, input }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || `Harness bridge failed (${response.status}).`);
    return payload.result;
  }

  subscribe(topic, handler) {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(this.url('/events'), {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`Harness event stream failed (${response.status}).`);
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of response.body) {
          pending += decoder.decode(chunk, { stream: true });
          let boundary;
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
            if (!data) continue;
            const event = JSON.parse(data);
            if (event.topic === topic) handler(event);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) handler({ topic: 'bridge/error', error: String(error?.message || error) });
      }
    })();
    return () => controller.abort();
  }
}

module.exports = { HarnessBridgeClient };
