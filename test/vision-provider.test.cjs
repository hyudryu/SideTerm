const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeScreenshot, parseStructuredPerception } = require('../electron/perception/vision-provider.cjs');

test('vision output is normalized from JSON or safe non-JSON text', () => {
  assert.equal(parseStructuredPerception('{"summary":"Dialog","confidence":0.9}').summary, 'Dialog');
  assert.equal(parseStructuredPerception('{"summary":"Dialog","visibleText":["OK"]}').confidence, 0.75);
  assert.equal(parseStructuredPerception('{"unexpected":true}').confidence, 0);
  assert.equal(parseStructuredPerception('{"summary":""}').confidence, 0);
  assert.equal(parseStructuredPerception('{"visibleText":[]}').confidence, 0);
  assert.equal(parseStructuredPerception('{"controls":[{}]}').confidence, 0);
  assert.equal(parseStructuredPerception('{"errors":["image unreadable"]}').confidence, 0);
  assert.equal(parseStructuredPerception('{"summary":"truncated"').confidence, 0);
  assert.match(parseStructuredPerception('{"summary":"truncated"').errors[0], /malformed JSON/);
  assert.equal(parseStructuredPerception(JSON.stringify({ visibleText: ['x'.repeat(2000)] })).visibleText[0].length, 1000);
  assert.equal(parseStructuredPerception(JSON.stringify({ errors: ['x'.repeat(1000)] })).errors[0].length, 500);
  assert.equal(parseStructuredPerception('A button is visible').confidence, 0.75);
});

test('vision permits a keyless local endpoint and aborts stalled requests', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let authorization = 'not-observed';
  global.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'A modal is visible' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'local-vision', timeoutMs: 1000
  });
  assert.equal(authorization, undefined);
  assert.equal(result.confidence, 0.75);

  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions', model: 'local-vision', timeoutMs: 100
  }), /timed out/);
});

test('vision refuses plaintext remote screenshot uploads', async () => {
  await assert.rejects(analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'http://vision.example.test/v1/chat/completions', model: 'vision-model', apiKey: 'secret'
  }), /must use HTTPS/);
});

test('vision does not follow screenshot upload redirects', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 307, headers: { Location: 'http://vision.example.test/upload' } });
  };
  await assert.rejects(analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'https://vision.example/v1/chat/completions', model: 'vision-model'
  }), /307/);
});

test('vision sends a readable high-detail image only to the configured endpoint', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let request;
  global.fetch = async (url, options) => {
    request = { url, redirect: options.redirect, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Ready","confidence":0.95}' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'https://vision.example/v1/chat/completions', model: 'vision-model', apiKey: 'secret', question: 'What is visible?'
  });
  assert.equal(result.summary, 'Ready');
  assert.equal(request.url, 'https://vision.example/v1/chat/completions');
  assert.equal(request.redirect, 'manual');
  assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(request.body.messages[1].content[1].image_url.detail, 'high');
});
