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
