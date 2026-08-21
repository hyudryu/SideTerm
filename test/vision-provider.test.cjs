const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeScreenshot, parseStructuredPerception } = require('../electron/perception/vision-provider.cjs');

test('vision output is normalized from JSON or safe non-JSON text', () => {
  assert.equal(parseStructuredPerception('{"summary":"Dialog","confidence":0.9}').summary, 'Dialog');
  assert.equal(parseStructuredPerception('A button is visible').confidence, 0.65);
});

test('vision sends a low-detail image only to the configured endpoint', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Ready","confidence":0.95}' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await analyzeScreenshot(Buffer.from('png'), {
    endpoint: 'https://vision.example/v1/chat/completions', model: 'vision-model', apiKey: 'secret', question: 'What is visible?'
  });
  assert.equal(result.summary, 'Ready');
  assert.equal(request.url, 'https://vision.example/v1/chat/completions');
  assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(request.body.messages[1].content[1].image_url.detail, 'low');
});
