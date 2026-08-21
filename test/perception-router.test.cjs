const test = require('node:test');
const assert = require('node:assert/strict');
const { PerceptionRouter, requiresVisualEvidence, structuredCollectionRequiresCompleteList, structuredStateSufficient } = require('../electron/perception/router.cjs');
const { fitSessionCollection, mergeLiveSessionRecords, structuredSessionRecord } = require('../electron/perception/structured-state.cjs');

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

test('perception continues after null and failed preferred sources', async () => {
  const router = new PerceptionRouter({
    structuredState: async () => null,
    accessibility: async () => { throw new Error('unavailable'); },
    terminalText: async () => ({ summary: 'Terminal is ready', confidence: 0.9 })
  });
  const result = await router.inspect();
  assert.equal(result.source, 'terminal-text');
});

test('visual questions fall through terminal text to styled capture', () => {
  assert.equal(requiresVisualEvidence('Which option is highlighted in red?'), true);
  assert.equal(requiresVisualEvidence('Is the prompt bold?'), true);
  assert.equal(requiresVisualEvidence('Is the terminal using a dark theme?'), true);
  assert.equal(requiresVisualEvidence('Is the background job still running?'), false);
  assert.equal(requiresVisualEvidence('Is the settings dialog open?'), true);
  assert.equal(requiresVisualEvidence('What command finished?'), false);
});

test('structured status questions do not require screenshot upload', () => {
  assert.equal(structuredStateSufficient('What is the supervisor status?'), true);
  assert.equal(structuredStateSufficient('Which sessions are busy?'), true);
  assert.equal(structuredStateSufficient('How many terminals are running?'), true);
  assert.equal(structuredStateSufficient('Which terminals are idle?'), true);
  assert.equal(structuredStateSufficient('Summarize this session.'), true);
  assert.equal(structuredStateSufficient('Is this session running?'), true);
  assert.equal(structuredStateSufficient('Is this session stopped?'), true);
  assert.equal(structuredStateSufficient('What command is running in this session?'), false);
  assert.equal(structuredStateSufficient('What is visible in the window?'), false);
});

test('structured collection payloads remain valid within the router summary limit', () => {
  const candidates = Array.from({ length: 200 }, (_, index) => ({
    id: `session-${index}`,
    title: `Session ${index}`,
    summary: 'x'.repeat(160),
    status: 'idle'
  }));
  const result = fitSessionCollection({
    sessionCollection: { total: 300, running: 1, idle: 199, stopped: 100 },
    supervisorStatus: 'idle'
  }, candidates);
  assert.ok(result.summary.length <= 3900);
  assert.deepEqual(JSON.parse(result.summary), result.payload);
  assert.equal(result.payload.sessionCollection.total, 300);
  assert.equal(result.payload.sessionCollection.truncated, true);
});

test('intentionally omitted session collections are marked incomplete', () => {
  const result = fitSessionCollection({ sessionCollection: { total: 3 } }, [], { includeSessions: false });
  assert.equal(result.payload.sessionCollection.returned, 0);
  assert.equal(result.payload.sessionCollection.truncated, true);
});

test('live sessions remain structured evidence before renderer metadata arrives', () => {
  assert.deepEqual(structuredSessionRecord({ sessionId: 'new-session', live: true }), {
    id: 'new-session',
    title: 'new-session',
    summary: '',
    busy: false,
    status: 'idle',
    needsAttention: false
  });
  assert.equal(structuredSessionRecord({ sessionId: 'stopped', live: false }), null);
});

test('collection metadata includes live sessions before renderer synchronization', () => {
  const merged = mergeLiveSessionRecords(
    [{ id: 'known', title: 'Known' }],
    ['known', 'new-session'],
    [{ id: 'new-session', friendlyName: 'New session', status: 'idle' }]
  );
  assert.deepEqual(merged.map((item) => item.id), ['known', 'new-session']);
  assert.equal(merged[1].title, 'New session');
  assert.equal(merged[1].busy, false);
});

test('authoritative process exit overrides stale busy renderer metadata', () => {
  const record = structuredSessionRecord({
    sessionId: 'stopped',
    live: false,
    metadata: { id: 'stopped', title: 'Stopped', busy: true }
  });
  assert.equal(record.status, 'stopped');
  assert.equal(record.busy, false);
});

test('truncated collections lower confidence only when the full member list is required', () => {
  assert.equal(structuredCollectionRequiresCompleteList('How many sessions are active?'), false);
  assert.equal(structuredCollectionRequiresCompleteList('How many terminals are active?'), false);
  assert.equal(structuredCollectionRequiresCompleteList('List all terminal names'), true);
  assert.equal(structuredCollectionRequiresCompleteList('List all session names'), true);
  assert.equal(structuredCollectionRequiresCompleteList('Which sessions are busy?'), true);
});
