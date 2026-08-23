const assert = require('node:assert/strict');
const test = require('node:test');
const { createInstallQueue } = require('../electron/voice/install-queue.cjs');

test('runs installs sequentially without overlap', async () => {
  const events = [];
  const queue = createInstallQueue(async (kind) => {
    events.push(`start:${kind}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push(`end:${kind}`);
  });

  await Promise.all([queue('stt'), queue('tts')]);

  assert.deepEqual(events, ['start:stt', 'end:stt', 'start:tts', 'end:tts']);
});

test('a queued install does not run until the active one settles', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const queue = createInstallQueue(async (kind) => {
    events.push(kind);
    if (kind === 'stt') await gate;
  });

  const first = queue('stt');
  const second = queue('tts');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ['stt']);

  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['stt', 'tts']);
});

test('deduplicates the same kind while pending but allows a later reinstall', async () => {
  let calls = 0;
  const queue = createInstallQueue(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  await Promise.all([queue('stt'), queue('stt')]);
  assert.equal(calls, 1);

  await queue('stt');
  assert.equal(calls, 2);
});

test('a failed install rejects its caller without blocking the queue', async () => {
  const events = [];
  const queue = createInstallQueue(async (kind) => {
    events.push(kind);
    if (kind === 'stt') throw new Error('pip exploded');
  });

  await assert.rejects(queue('stt'), /pip exploded/);
  await queue('tts');
  assert.deepEqual(events, ['stt', 'tts']);
});
