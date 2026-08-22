const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { audioFileExtension, canonicalCloudAudioFormat, convertToSpeechPcm, convertToSpeechWav, packagedExecutablePath } = require('../electron/voice/audio-converter.cjs');

test('packaged ffmpeg executables are resolved outside the asar archive', () => {
  assert.equal(
    packagedExecutablePath('/opt/SideTerm/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'),
    '/opt/SideTerm/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
  );
});

test('recording MIME types retain a compatible file extension', () => {
  assert.equal(audioFileExtension('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(audioFileExtension('audio/mpeg'), 'mp3');
  assert.equal(audioFileExtension('audio/ogg;codecs=opus'), 'ogg');
});

test('cloud providers with strict upload formats use canonical audio', () => {
  assert.equal(canonicalCloudAudioFormat('aws'), 'pcm');
  assert.equal(canonicalCloudAudioFormat('google'), 'wav');
  assert.equal(canonicalCloudAudioFormat('azure'), 'wav');
  assert.equal(canonicalCloudAudioFormat('deepgram'), '');
});

test('microphone recordings are converted to mono 16 kHz PCM WAV', async () => {
  let invocation;
  const spawnProcess = (executable, args) => {
    invocation = { executable, args };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  await convertToSpeechWav('/tmp/input.webm', '/tmp/output.wav', {
    ffmpegPath: '/bundled/ffmpeg', spawnProcess
  });
  assert.equal(invocation.executable, '/bundled/ffmpeg');
  assert.deepEqual(invocation.args.slice(-9), ['-i', '/tmp/input.webm', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/tmp/output.wav']);
});

test('AWS conversion emits raw 16 kHz mono PCM', async () => {
  let args;
  const spawnProcess = (_executable, invocation) => {
    args = invocation;
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  await convertToSpeechPcm('/tmp/input.ogg', '/tmp/output.pcm', { ffmpegPath: '/ffmpeg', spawnProcess });
  assert.deepEqual(args.slice(-7), ['-ac', '1', '-ar', '16000', '-f', 's16le', '/tmp/output.pcm']);
});
