const test = require('node:test');
const assert = require('node:assert/strict');
const { PerceptionRouter } = require('../electron/perception/router.cjs');

test('perception prefers structured state and never calls cloud vision unnecessarily', async () => {
  let cloudCalled = false;
  const router = new PerceptionRouter({
    structuredState: async () => ({ summary: 'PR is ready', confidence: 0.95 }),
    separateVision: async () => { cloudCalled = true; return { summary: 'image', confidence: 1 }; }
  });
  const result = await router.inspect({ allowCloudVision: true });
  assert.equal(result.source, 'structured-state');
  assert.equal(cloudCalled, false);
});

test('cloud vision is opt-in and returns structured text only', async () => {
  const router = new PerceptionRouter({
    separateVision: async () => ({ summary: 'A dialog is open', visibleText: ['Continue'], confidence: 0.9 })
  });
  assert.equal((await router.inspect()).source, 'none');
  assert.equal((await router.inspect({ allowCloudVision: true })).source, 'separate-vision');
});
