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

test('native vision is also gated because the supervisor endpoint may be remote', async () => {
  let called = false;
  const router = new PerceptionRouter({
    nativeVision: async () => { called = true; return { summary: 'visible', confidence: 1 }; }
  });
  assert.equal((await router.inspect()).source, 'none');
  assert.equal(called, false);
  assert.equal((await router.inspect({ allowCloudVision: true })).source, 'native-vision');
});

test('explicit screenshot inspection bypasses non-visual high-confidence sources', async () => {
  const calls = [];
  const router = new PerceptionRouter({
    structuredState: async () => { calls.push('structured'); return { summary: 'text', confidence: 1 }; },
    terminalText: async () => { calls.push('terminal'); return { summary: 'text', confidence: 1 }; },
    nativeVision: async () => { calls.push('vision'); return { summary: 'pixels', confidence: 0.9 }; }
  });
  const result = await router.inspect({ allowCloudVision: true, forceVision: true });
  assert.equal(result.source, 'native-vision');
  assert.deepEqual(calls, ['vision']);
});
