const test = require('node:test');
const assert = require('node:assert/strict');
const { PresentationCoordinator, deterministicPresentation, presentationDelivered } = require('../electron/supervisor/presentation.cjs');

test('deterministic presenter gives useful trusted updates', () => {
  assert.equal(deterministicPresentation({ kind: 'COMPLETED', title: 'Toolbar', summary: 'Tests pass.' }), 'Toolbar finished. Tests pass.');
  assert.equal(deterministicPresentation({ kind: 'INPUT_REQUIRED', title: 'API' }), 'API needs your input.');
});

test('presentation coordinator serializes each output surface', async () => {
  const coordinator = new PresentationCoordinator();
  const spoken = [];
  coordinator.registerSurface('desktop', async (text) => {
    if (text === 'one') await new Promise((resolve) => setTimeout(resolve, 5));
    spoken.push(text);
  });
  await Promise.all([coordinator.present('one'), coordinator.present('two')]);
  assert.deepEqual(spoken, ['one', 'two']);
});

test('presentation coordinator drops stale queued activation speech', async () => {
  const coordinator = new PresentationCoordinator();
  const spoken = [];
  let release;
  coordinator.registerSurface('desktop', async (text) => {
    if (text === 'blocking') await new Promise((resolve) => { release = resolve; });
    spoken.push(text);
  });
  const first = coordinator.present('blocking');
  await new Promise((resolve) => setImmediate(resolve));
  let current = true;
  const stale = coordinator.present('stale', { isCurrent: () => current });
  current = false;
  release();
  await Promise.all([first, stale]);
  assert.deepEqual(spoken, ['blocking']);
});

test('delivery succeeds only when a surface confirms presentation', () => {
  assert.equal(presentationDelivered([{ status: 'fulfilled', value: true }]), true);
  assert.equal(presentationDelivered([{ status: 'fulfilled', value: false }]), false);
  assert.equal(presentationDelivered([{ status: 'rejected', reason: new Error('TTS failed') }]), false);
});
