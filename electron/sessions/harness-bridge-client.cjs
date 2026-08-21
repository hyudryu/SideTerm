class HarnessBridgeClient {
  constructor(options = {}) {
    this.endpoint = new URL(options.endpoint || 'http://127.0.0.1:43111');
    if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(this.endpoint.hostname)) throw new Error('Harness bridge must use a loopback endpoint.');
    if (this.endpoint.protocol !== 'http:') throw new Error('Harness bridge must use loopback HTTP.');
    this.token = String(options.token || '');
    if (this.token.length < 24) throw new Error('Harness bridge token must contain at least 24 characters.');
    this.fetch = options.fetch || fetch;
    this.reconnectDelayMs = Math.max(10, Number(options.reconnectDelayMs) || 1_000);
  }

  url(pathname) {
    return new URL(pathname, this.endpoint).toString();
  }

  async request(method, input = {}) {
    const response = await this.fetch(this.url('/rpc'), {
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
    const waitToReconnect = (delay) => new Promise((resolve) => {
      const timer = setTimeout(resolve, delay);
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          const response = await this.fetch(this.url('/events'), {
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
            signal: controller.signal
          });
          if (!response.ok || !response.body) throw new Error(`Harness event stream failed (${response.status}).`);
          failures = 0;
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
          if (!controller.signal.aborted) throw new Error('Harness event stream disconnected.');
        } catch (error) {
          if (controller.signal.aborted) break;
          failures += 1;
          handler({ topic: 'bridge/error', error: String(error?.message || error) });
          await waitToReconnect(Math.min(10_000, this.reconnectDelayMs * (2 ** Math.min(failures - 1, 4))));
        }
      }
    })();
    return () => controller.abort();
  }
}

module.exports = { HarnessBridgeClient };
