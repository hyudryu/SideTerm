const test = require('node:test');
const assert = require('node:assert/strict');
const { HarnessBridgeClient } = require('../electron/sessions/harness-bridge-client.cjs');

test('Harness bridge accepts authenticated loopback endpoints only', () => {
  assert.throws(() => new HarnessBridgeClient({ endpoint: 'https://remote.example', token: 'a'.repeat(24) }), /loopback/);
  assert.throws(() => new HarnessBridgeClient({ endpoint: 'http://127.0.0.1:43111', token: 'short' }), /24 characters/);
  assert.doesNotThrow(() => new HarnessBridgeClient({ endpoint: 'http://127.0.0.1:43111', token: 'a'.repeat(24) }));
  assert.doesNotThrow(() => new HarnessBridgeClient({ endpoint: 'http://[::1]:43111', token: 'a'.repeat(24) }));
});

test('Harness event subscriptions reconnect after startup and stream failures', async () => {
  let attempts = 0;
  let dispose;
  const eventReceived = new Promise((resolve) => {
    const client = new HarnessBridgeClient({
      endpoint: 'http://127.0.0.1:43111', token: 'secret-secret-secret-secret', reconnectDelayMs: 10,
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Harness is starting');
        return {
          ok: true,
          body: (async function* stream() {
            yield Buffer.from('data: {"topic":"session/event","sessionId":"a"}\n\n');
          })()
        };
      }
    });
    dispose = client.subscribe('session/event', (event) => {
      if (event.topic === 'session/event') resolve(event);
    });
  });
  const event = await eventReceived;
  dispose();
  assert.equal(event.sessionId, 'a');
  assert.equal(attempts, 2);
});

test('Harness bridge sends one semantic RPC request with bearer authentication', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let received;
  global.fetch = async (url, options) => {
    received = { url, authorization: options.headers.Authorization, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ result: { accepted: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new HarnessBridgeClient({ endpoint: 'http://127.0.0.1:43111', token: 'secret-secret-secret-secret' });
  assert.deepEqual(await client.request('agents.followup', { id: 'a', message: 'Fix review' }), { accepted: true });
  assert.equal(received.url, 'http://127.0.0.1:43111/rpc');
  assert.equal(received.authorization, 'Bearer secret-secret-secret-secret');
  assert.equal(received.body.method, 'agents.followup');
});
