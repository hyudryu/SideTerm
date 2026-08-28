const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { PersistentSpeechWorker } = require('../electron/voice/worker.cjs');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    write(value, callback) {
      this.writes.push(value);
      callback?.();
    }
  };
  child.kill = () => child.emit('exit', null, 'SIGTERM');
  return child;
}

test('one persistent speech process serves multiple requests', async () => {
  const child = fakeChild();
  let spawns = 0;
  const worker = new PersistentSpeechWorker({
    executable: 'python',
    args: ['sidecar.py', 'serve'],
    spawnProcess: () => { spawns += 1; return child; }
  });

  const first = worker.request('transcribe', { input: 'one.webm' });
  const firstRequest = JSON.parse(child.stdin.writes[0]);
  child.stdout.emit('data', `${JSON.stringify({ requestId: firstRequest.requestId, ok: true, result: { text: 'hello' } })}\n`);
  assert.deepEqual(await first, { text: 'hello' });

  const second = worker.request('synthesize', { output: 'two.wav' });
  const secondRequest = JSON.parse(child.stdin.writes[1]);
  child.stdout.emit('data', `${JSON.stringify({ requestId: secondRequest.requestId, ok: true, result: { output: 'two.wav' } })}\n`);
  assert.deepEqual(await second, { output: 'two.wav' });
  assert.equal(spawns, 1);
  worker.stop();
});

test('speech worker errors reject the matching request', async () => {
  const child = fakeChild();
  const worker = new PersistentSpeechWorker({ executable: 'python', args: [], spawnProcess: () => child });
  const result = worker.request('synthesize');
  const request = JSON.parse(child.stdin.writes[0]);
  child.stdout.emit('data', `${JSON.stringify({ requestId: request.requestId, ok: false, error: 'bad voice' })}\n`);
  await assert.rejects(result, /bad voice/);
  worker.stop();
});

test('cancelling synthesis rejects stale syntheses but spares in-flight transcription', async () => {
  const child = fakeChild();
  let killed = 0;
  child.kill = () => { killed += 1; };
  const worker = new PersistentSpeechWorker({ executable: 'python', args: [], spawnProcess: () => child });

  const stale = worker.request('synthesize', { output: 'stale.wav' });
  assert.equal(worker.cancelSynthesis(), true);
  await assert.rejects(stale, /cancelled/);
  assert.equal(killed, 1);

  const transcript = worker.request('transcribe', { input: 'one.webm' });
  const queued = worker.request('synthesize', { output: 'new.wav' });
  assert.equal(worker.cancelSynthesis(), true);
  await assert.rejects(queued, /cancelled/);
  assert.equal(killed, 1, 'an in-flight transcription must not be killed');

  const transcriptRequest = JSON.parse(child.stdin.writes[1]);
  child.stdout.emit('data', `${JSON.stringify({ requestId: transcriptRequest.requestId, ok: true, result: { text: 'hello' } })}\n`);
  assert.deepEqual(await transcript, { text: 'hello' });
  worker.stop();
});

test('cancel synthesis is a no-op with nothing pending', () => {
  const worker = new PersistentSpeechWorker({ executable: 'python', args: [], spawnProcess: () => fakeChild() });
  assert.equal(worker.cancelSynthesis(), false);
  worker.stop();
});

test('cancel synthesis only rejects requests carrying the superseded token', async () => {
  const child = fakeChild();
  let killed = 0;
  child.kill = () => { killed += 1; };
  const worker = new PersistentSpeechWorker({ executable: 'python', args: [], spawnProcess: () => child });

  const desktop = worker.request('synthesize', { output: 'desk.wav', token: 'desktop-voice' });
  const mobile = worker.request('synthesize', { output: 'phone.wav' });
  assert.equal(worker.cancelSynthesis('cancelled', 'desktop-voice'), true);
  await assert.rejects(desktop, /cancelled/);
  const mobileRequest = JSON.parse(child.stdin.writes[1]);
  child.stdout.emit('data', `${JSON.stringify({ requestId: mobileRequest.requestId, ok: true, result: { output: 'phone.wav' } })}\n`);
  assert.deepEqual(await mobile, { output: 'phone.wav' }, 'unrelated synthesis must survive');
  assert.equal(killed, 0, 'kill is skipped while an unrelated synthesis is still pending');
  worker.stop();
});

test('cancelling a synthesis queued behind warm-up stops the sidecar to free the pipeline', async () => {
  const child = fakeChild();
  let killed = 0;
  child.kill = () => { killed += 1; };
  const worker = new PersistentSpeechWorker({ executable: 'python', args: [], spawnProcess: () => child });

  const warm = worker.request('warm-tts', { voice: 'alba' });
  const stale = worker.request('synthesize', { output: 'stale.wav' });
  assert.equal(worker.cancelSynthesis('cancelled'), true);
  await assert.rejects(stale, /cancelled/);
  assert.equal(killed, 1, 'the stale synthesis would otherwise still run to completion');
  worker.stop();
  await assert.rejects(warm, /stopped/);
});
