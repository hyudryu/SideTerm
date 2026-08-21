const test = require('node:test');
const assert = require('node:assert/strict');
const { awsCredentials, providerDescriptor, transcribeCloud } = require('../electron/voice/stt-providers.cjs');

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
