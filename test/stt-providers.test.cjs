const test = require('node:test');
const assert = require('node:assert/strict');
const { awsCredentials, providerConfigurationError, providerDescriptor, transcribeCloud } = require('../electron/voice/stt-providers.cjs');

test('STT provider descriptors visibly distinguish local and cloud', () => {
  assert.equal(providerDescriptor('parakeet').location, 'local');
  assert.equal(providerDescriptor('deepgram').location, 'cloud');
  assert.equal(providerDescriptor('openai').supportsStreaming, true);
});

test('cloud STT never runs without the selected provider credential', async () => {
  await assert.rejects(transcribeCloud('deepgram', Buffer.from('audio'), { mimeType: 'audio/webm' }), /credentials are not configured/);
  await assert.rejects(transcribeCloud('parakeet', Buffer.from('audio'), { credential: 'unused' }), /not a cloud speech provider/);
});

test('only the explicitly selected cloud provider receives audio', async (context) => {
  const requests = [];
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization, body: Buffer.from(options.body).toString() });
    return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'Tests passed', confidence: 0.9 }] }] } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await transcribeCloud('deepgram', Buffer.from('private audio'), {
    credential: 'secret', mimeType: 'audio/webm', vocabulary: ['SideTerm']
  });
  assert.equal(result.text, 'Tests passed');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.deepgram\.com\//);
  assert.equal(requests[0].body, 'private audio');
});

test('Amazon credentials accept secure JSON or colon-separated values', () => {
  assert.deepEqual(awsCredentials('{"accessKeyId":"id","secretAccessKey":"secret"}'), { accessKeyId: 'id', secretAccessKey: 'secret' });
  assert.deepEqual(awsCredentials('id:secret:token'), { accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 'token' });
});

test('cloud readiness includes each provider specific region requirement', () => {
  assert.match(providerConfigurationError('azure', { credential: 'secret' }), /region or endpoint/);
  assert.equal(providerConfigurationError('azure', { credential: 'secret', endpoint: 'https://example.test' }), '');
  assert.match(providerConfigurationError('aws', { credential: 'id:secret' }), /region/);
  assert.equal(providerConfigurationError('aws', { credential: 'id:secret', region: 'us-west-2' }), '');
});

test('Google joins every final recognition segment', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ results: [
    { alternatives: [{ transcript: 'Run the tests', confidence: 0.8 }] },
    { alternatives: [{ transcript: 'then push it', confidence: 1 }] }
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await transcribeCloud('google', Buffer.from('audio'), {
    credential: 'secret', mimeType: 'audio/webm', timeoutMs: 1000
  });
  assert.equal(result.text, 'Run the tests then push it');
  assert.equal(result.confidence, 0.9);
});

test('cloud transcription aborts a stalled provider request', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(transcribeCloud('deepgram', Buffer.from('audio'), {
    credential: 'secret', mimeType: 'audio/webm', timeoutMs: 100
  }), /timed out/);
});
