const test = require('node:test');
const assert = require('node:assert/strict');
const { PresentationCoordinator, deterministicPresentation } = require('../electron/supervisor/presentation.cjs');

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
