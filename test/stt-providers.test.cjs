const test = require('node:test');
const assert = require('node:assert/strict');
const { awsAudioEvents, awsClientConfiguration, awsCredentials, providerConfigurationError, providerDescriptor, providerScopedSetting, sttEndpointConfigurationError, transcribeCloud } = require('../electron/voice/stt-providers.cjs');

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

test('Amazon client configuration honors a selected private endpoint', () => {
  assert.deepEqual(awsClientConfiguration({
    region: 'us-west-2', credential: 'id:secret', endpoint: 'https://vpce.example.test'
  }), {
    region: 'us-west-2', credentials: { accessKeyId: 'id', secretAccessKey: 'secret' }, endpoint: 'https://vpce.example.test'
  });
});

test('Amazon streaming audio events stay below the service size limit', async () => {
  const events = [];
  const delays = [];
  for await (const event of awsAudioEvents(Buffer.alloc(70 * 1024), { sleep: async (delay) => delays.push(delay) })) events.push(event);
  assert.ok(events.length > 2);
  assert.ok(events.every((event) => event.AudioEvent.AudioChunk.length <= 3_200));
  assert.equal(events.reduce((total, event) => total + event.AudioEvent.AudioChunk.length, 0), 70 * 1024);
  assert.equal(delays.length, events.length - 1);
  assert.ok(delays.every((delay) => delay > 0 && delay <= 100));
});

test('cloud readiness includes each provider specific region requirement', () => {
  assert.match(providerConfigurationError('azure', { credential: 'secret' }), /region or endpoint/);
  assert.equal(providerConfigurationError('azure', { credential: 'secret', endpoint: 'https://example.test' }), '');
  assert.match(providerConfigurationError('aws', { credential: 'id:secret' }), /region/);
  assert.match(providerConfigurationError('aws', { credential: 'secret', region: 'us-west-2' }), /accessKeyId:secretAccessKey/);
  assert.match(providerConfigurationError('aws', { credential: '{}', region: 'us-west-2' }), /accessKeyId:secretAccessKey/);
  assert.equal(providerConfigurationError('aws', { credential: 'id:secret', region: 'us-west-2' }), '');
  assert.equal(providerConfigurationError('aws', {
    credential: '{"accessKeyId":"id","secretAccessKey":"secret"}', region: 'us-west-2'
  }), '');
});

test('cloud STT endpoints require encrypted transport except on explicit loopback', () => {
  assert.match(sttEndpointConfigurationError('http://speech.example.test/v1'), /must use HTTPS/);
  assert.equal(sttEndpointConfigurationError('https://speech.example.test/v1'), '');
  assert.equal(sttEndpointConfigurationError('http://127.0.0.1:9000/v1'), '');
  assert.equal(sttEndpointConfigurationError('http://localhost:9000/v1'), '');
  assert.match(providerConfigurationError('deepgram', {
    credential: 'secret', endpoint: 'http://speech.example.test/v1'
  }), /must use HTTPS/);
});

test('provider changes clear omitted settings but preserve explicit repeated values', () => {
  const endpoint = 'https://speech.example.test/v1';
  assert.equal(providerScopedSetting(endpoint, undefined, true), '');
  assert.equal(providerScopedSetting(endpoint, endpoint, true), endpoint);
  assert.equal(providerScopedSetting(endpoint, undefined, false), endpoint);
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

test('OpenAI transcripts without confidence do not manufacture an uncertainty score', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ text: 'Review the code' }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  const result = await transcribeCloud('openai', Buffer.from('audio'), {
    credential: 'secret', mimeType: 'audio/webm', timeoutMs: 1000
  });
  assert.equal(result.text, 'Review the code');
  assert.equal(result.confidence, undefined);
});

test('switching from local to cloud STT releases only Parakeet state', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');
  const sidecar = fs.readFileSync(require.resolve('../electron/voice/sidecar.py'), 'utf8');
  assert.match(main, /providerDescriptor\(current\.sttProvider\)\.location === 'local'/);
  assert.match(main, /providerDescriptor\(next\.sttProvider\)\.location === 'cloud'/);
  assert.match(main, /writeSettingsRecord\(next\);\s*if \(releaseLocalStt\) void releaseLocalSpeechRecognition\(\)\.catch/);
  assert.match(main, /function releaseLocalSpeechRecognition\(\)[\s\S]*speechWorker\.request\('release-stt'\)/);
  assert.match(sidecar, /elif command == "release-stt":\s*result = release_stt_models\(\)/);
});

test('erasing a replacement keeps an explicit credential removal pending', () => {
  const fs = require('node:fs');
  const renderer = fs.readFileSync(require.resolve('../src/main.js'), 'utf8');
  assert.match(renderer, /let sttCredentialRemovalIntent = false/);
  assert.match(renderer, /#clear-stt-credential'[\s\S]*sttCredentialRemovalIntent = true;[\s\S]*clearSttCredentialRequested = true/);
  assert.match(renderer, /#stt-credential'\)\.addEventListener\('input'[\s\S]*clearSttCredentialRequested = sttCredentialRemovalIntent && !event\.target\.value\.trim\(\)/);
});

test('Azure labels canonical WAV input with its required PCM format', async (context) => {
  const originalFetch = global.fetch;
  let request;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    request = { url: String(url), headers: options.headers };
    return new Response(JSON.stringify({ DisplayText: 'Run the tests' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await transcribeCloud('azure', Buffer.from('pcm wav'), {
    credential: 'secret', endpoint: 'https://westus.example.test/recognize', mimeType: 'audio/wav', timeoutMs: 1000
  });
  assert.equal(result.text, 'Run the tests');
  assert.equal(request.headers['Content-Type'], 'audio/wav; codecs=audio/pcm; samplerate=16000');
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
