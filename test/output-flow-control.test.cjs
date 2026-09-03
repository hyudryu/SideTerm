const assert = require('node:assert/strict');
const test = require('node:test');
const { createOutputFlowControl } = require('../electron/sessions/output-flow-control.cjs');

function fixture() {
  const calls = { pause: 0, resume: 0 };
  const flow = createOutputFlowControl({
    pause() { calls.pause += 1; },
    resume() { calls.resume += 1; }
  }, { highWaterBytes: 100, lowWaterBytes: 25 });
  return { calls, flow };
}

test('pauses once at the high watermark and resumes below the low watermark', () => {
  const { calls, flow } = fixture();
  flow.accept(60);
  flow.accept(40);
  flow.accept(100);
  assert.deepEqual(calls, { pause: 1, resume: 0 });
  assert.deepEqual(flow.snapshot(), { pendingBytes: 200, paused: true, disposed: false });

  flow.acknowledge(174);
  assert.deepEqual(calls, { pause: 1, resume: 0 });
  flow.acknowledge(1);
  assert.deepEqual(calls, { pause: 1, resume: 1 });
  assert.deepEqual(flow.snapshot(), { pendingBytes: 25, paused: false, disposed: false });
});

test('sessions have independent queues and reset releases a paused process', () => {
  const first = fixture();
  const second = fixture();
  first.flow.accept(100);
  assert.equal(first.calls.pause, 1);
  assert.equal(second.calls.pause, 0);

  first.flow.reset();
  assert.deepEqual(first.calls, { pause: 1, resume: 1 });
  assert.deepEqual(first.flow.snapshot(), { pendingBytes: 0, paused: false, disposed: false });
});

test('dispose clears accounting without resuming an exiting process', () => {
  const { calls, flow } = fixture();
  flow.accept(100);
  flow.dispose();
  flow.acknowledge(100);
  flow.reset();
  assert.deepEqual(calls, { pause: 1, resume: 0 });
  assert.deepEqual(flow.snapshot(), { pendingBytes: 0, paused: false, disposed: true });
});

test('accepted byte totals survive replay joins that combine split surrogate pairs', () => {
  const { calls, flow } = fixture();
  const chunks = Array.from({ length: 20 }, () => ['\ud83d', '\ude42']).flat();
  const acceptedBytes = chunks.map((chunk) => Buffer.byteLength(chunk));
  for (const byteLength of acceptedBytes) flow.accept(byteLength);
  assert.equal(flow.snapshot().pendingBytes, 120);
  assert.equal(Buffer.byteLength(chunks.join('')), 80);

  flow.acknowledge(acceptedBytes.reduce((total, byteLength) => total + byteLength, 0));
  assert.deepEqual(flow.snapshot(), { pendingBytes: 0, paused: false, disposed: false });
  assert.deepEqual(calls, { pause: 1, resume: 1 });
});
