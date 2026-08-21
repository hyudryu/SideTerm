const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { convertToSpeechWav, packagedExecutablePath } = require('../electron/voice/audio-converter.cjs');

test('packaged ffmpeg executables are resolved outside the asar archive', () => {
  assert.equal(
    packagedExecutablePath('/opt/SideTerm/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'),
    '/opt/SideTerm/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
  );
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
