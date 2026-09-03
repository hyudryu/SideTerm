const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTerminalCheckpointStore } = require('../electron/sessions/terminal-checkpoints.cjs');

function checkpoint(id, state, revision = 1) {
  return {
    id,
    terminalState: state,
    mobileTerminalState: '\u001bcviewport',
    terminalStateCols: 120,
    terminalStateRows: 40,
    hostGeneration: `${id}-generation`,
    durableOutputRevision: revision
  };
}

test('per-session terminal checkpoints persist independently beyond the workspace budget', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-checkpoints-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createTerminalCheckpointStore({ directory });
  const first = checkpoint('first', `first:${'a'.repeat(4 * 1024 * 1024)}`);
  const second = checkpoint('second', `second:${'b'.repeat(4 * 1024 * 1024)}`);

  store.save(first);
  store.save(second);

  assert.equal(store.read('first').terminalState, first.terminalState);
  assert.equal(store.read('second').terminalState, second.terminalState);
});

test('an atomic checkpoint commit failure preserves the previous sidecar', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-checkpoints-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createTerminalCheckpointStore({ directory }).save(checkpoint('stable', 'old-state', 2));
  const failingStore = createTerminalCheckpointStore({
    directory,
    beforeCommit: () => { throw new Error('simulated commit failure'); }
  });

  assert.throws(() => failingStore.save(checkpoint('stable', 'new-state', 3)), /simulated/);
  assert.deepEqual(createTerminalCheckpointStore({ directory }).read('stable'), {
    version: 1, ...checkpoint('stable', 'old-state', 2)
  });
});

test('checkpoint restore is single-session and pruning removes stale records and crash temporaries', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-checkpoints-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createTerminalCheckpointStore({ directory });
  store.save(checkpoint('active', 'active-state'));
  store.save(checkpoint('closed', 'closed-state'));
  const activeFilename = fs.readdirSync(directory).find((name) => (
    JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')).id === 'active'
  ));
  fs.writeFileSync(path.join(directory, `${activeFilename}.00000000-0000-0000-0000-000000000000.tmp`), 'partial');

  assert.equal(store.read('active').id, 'active');
  store.prune(['active']);

  assert.equal(store.read('active').id, 'active');
  assert.equal(store.read('closed'), null);
  assert.deepEqual(fs.readdirSync(directory), [activeFilename]);
});
