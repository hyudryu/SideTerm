const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  bufferRendererOutput,
  reattachSession,
  sessionDetails,
  takeRendererOutput
} = require('../electron/sessions/reattach.cjs');

test('renderer reload reattaches to the existing PTY without replacing it', () => {
  const resizeCalls = [];
  const processHandle = {
    pid: 4172,
    resize: (cols, rows) => resizeCalls.push([cols, rows])
  };
  const session = {
    processHandle,
    cwd: 'C:\\Users\\markx',
    shell: 'powershell.exe',
    rows: 24,
    tmux: null
  };

  const details = reattachSession('session-live', session, { cols: 132, rows: 41 });

  assert.equal(session.processHandle, processHandle);
  assert.equal(session.cols, 132);
  assert.equal(session.rows, 41);
  assert.deepEqual(resizeCalls, [[132, 41]]);
  assert.deepEqual(details, {
    id: 'session-live',
    pid: 4172,
    cwd: 'C:\\Users\\markx',
    shell: 'powershell.exe',
    resumed: false,
    reattached: true,
    persistent: false,
    serverScrollback: false
  });
});

test('renderer output emitted during reload is retained until the renderer-ready handshake', () => {
  const session = {
    processHandle: { pid: 4173, resize() {} },
    cwd: 'C:\\Users\\markx',
    shell: 'powershell.exe',
    rows: 24,
    tmux: null
  };

  bufferRendererOutput(session, 'before-');
  bufferRendererOutput(session, 'after');
  reattachSession('session-live', session);
  const first = takeRendererOutput(session);
  const second = takeRendererOutput(session);

  assert.equal(first, 'before-after');
  assert.equal(second, '');
});

test('renderer reload replay buffer retains the full unacknowledged delivery', () => {
  const session = {};
  const data = `start:${'x'.repeat(350_000)}:end`;
  bufferRendererOutput(session, data);
  assert.equal(session.rendererReplay, data);
});

test('new session details are not marked as a renderer reattachment', () => {
  const details = sessionDetails('session-new', {
    processHandle: { pid: 9173 },
    cwd: '/workspace',
    shell: 'bash',
    tmux: { binary: 'tmux' }
  }, { resumed: false });

  assert.deepEqual(details, {
    id: 'session-new',
    pid: 9173,
    cwd: '/workspace',
    shell: 'bash',
    resumed: false,
    reattached: false,
    persistent: true,
    serverScrollback: true
  });
});

test('Windows-hosted sessions report process persistence with local xterm scrollback', () => {
  const details = sessionDetails('session-windows', {
    processHandle: { pid: 9174 },
    cwd: 'C:\\workspace',
    shell: 'powershell.exe',
    tmux: null,
    windowsHosted: true
  });

  assert.equal(details.persistent, true);
  assert.equal(details.serverScrollback, false);
});

test('reattachment clamps invalid terminal dimensions', () => {
  const resizeCalls = [];
  const session = {
    processHandle: { pid: 7, resize: (...dimensions) => resizeCalls.push(dimensions) },
    cwd: '/workspace',
    shell: 'bash',
    tmux: null
  };

  reattachSession('session-live', session, { cols: 1, rows: 0 });

  assert.deepEqual(resizeCalls, [[2, 30]]);
  assert.equal(session.cols, 2);
  assert.equal(session.rows, 30);
});

test('session creation reattaches a live ID before spawning another shell', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const start = main.indexOf('function createSession(');
  const end = main.indexOf('\nfunction closeSession(', start);
  const createSessionSource = main.slice(start, end);

  const lookup = createSessionSource.indexOf('const existingSession = sessions.get(id)');
  const reattach = createSessionSource.indexOf('return reattachSession(id, existingSession');
  const spawn = createSessionSource.indexOf('pty.spawn(');

  assert.ok(lookup >= 0);
  assert.ok(reattach > lookup);
  assert.ok(spawn > reattach);
});

test('main buffers output per session until the renderer-ready handshake flushes it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(main, /if \(session\.rendererAttached && terminalRendererCanAcknowledge\(\)\) \{[\s\S]*?sendTerminalData\(\s*id, data, session\.rendererFlow, replayClaimToken, hostGeneration, outputRevision\s*\);[\s\S]*?\} else \{\s*bufferRendererOutput\(session, data\);/);
  assert.match(main, /ipcMain\.handle\('terminal:renderer-ready'[\s\S]*?markTerminalRendererReady/);
  assert.match(preload, /markRendererReady: \(id\) => ipcRenderer\.invoke\('terminal:renderer-ready', id\)/);
  assert.match(renderer, /const details = await api\.createSession[\s\S]*?await api\.markRendererReady\(id\);/);
  assert.match(main, /rendererReplayInFlight = \{[\s\S]*?claimToken: replayClaimToken,[\s\S]*?deliveryToken: replayDeliveryToken/);
  assert.match(main, /terminal:data-ack'[\s\S]*?rendererReplayInFlight\?\.claimToken === String\(replayClaimToken[\s\S]*?rendererReplayInFlight\.deliveryToken === String\(replayDeliveryToken[\s\S]*?processHandle\.acknowledgeReplay/);
  assert.match(renderer, /terminal\.write\(data, \(\) => \{[\s\S]*?api\.acknowledgeData\([\s\S]*?replayClaimToken, replayDeliveryToken, rendererDataDeliveryToken,[\s\S]*?exitClaimToken, exitDeliveryToken/);
  assert.match(main, /function deliverDesktopExitedSession[\s\S]*?exitClaimToken: exited\.exitClaimToken[\s\S]*?exitDeliveryToken/);
  assert.match(main, /terminal:exit-ack'[\s\S]*?acknowledgeDesktopExitedSession/);
  assert.match(renderer, /api\.acknowledgeExit\(id, exitClaimToken, exitDeliveryToken\);/);
  assert.match(main, /function requeueRendererOutput[\s\S]*?rendererOutputInFlight[\s\S]*?unacknowledged[\s\S]*?rendererReplay/);
  assert.doesNotMatch(main, /rendererReplay = [^;]*\.slice\(-300_000\)/);
  assert.match(main, /rendererOutputInFlight\.findIndex[\s\S]*?rendererDataDeliveryToken/);
  assert.match(main, /if \(deliveryIndex >= 0\) \{\s*const \[delivery\] = session\.rendererOutputInFlight\.splice\(deliveryIndex, 1\);\s*session\.rendererFlow\.acknowledge\(delivery\.acceptedBytes \?\? Buffer\.byteLength\(delivery\.data\)\);/);
  assert.match(main, /function applyPersistedRendererCheckpoint[\s\S]*?session\.processHandle\.checkpoint\?\.\(checkpointRevision\)[\s\S]*?session\.rendererReplay = ''/);
  assert.match(main, /session\.rendererFlow\?\.acknowledge\(session\.rendererReplayAcceptedBytes \|\| 0\)/);
  assert.match(main, /bufferRendererOutput\(session, data\);\s*const acceptedBytes = Buffer\.byteLength\(data\);\s*session\.rendererFlow\.accept\(acceptedBytes\);\s*session\.rendererReplayAcceptedBytes \+= acceptedBytes/);
  assert.match(main, /sendTerminalData\(\s*id, replay, session\.rendererFlow, replayClaimToken, hostGeneration, outputRevision, true,\s*replayAcceptedBytes\s*\)/);
  assert.doesNotMatch(main, /resetTerminalOutputFlow/);
  assert.match(main, /createReplayAwareWindowsVtOutputNormalizer\(\{[\s\S]*?hostGeneration[\s\S]*?outputRevision/);
});

test('session creation shares pending work and a close cancels before registration', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(main, /const pendingSession = pendingSessionCreations\.get\(id\);\s*if \(pendingSession\) return pendingSession\.promise;/);
  assert.match(main, /if \(pendingCreation\.cancelled\) \{[\s\S]*?await processHandle\.kill\(\);[\s\S]*?closed before creation completed/);
  assert.match(main, /const pendingCreation = pendingSessionCreations\.get\(id\);\s*if \(pendingCreation\) \{\s*pendingCreation\.cancelled = true;[\s\S]*?await pendingCreation\.promise/);
  assert.match(renderer, /const details = await api\.createSession[\s\S]*?if \(sessions\.get\(id\) !== session\) return session;[\s\S]*?await api\.markRendererReady\(id\);\s*if \(sessions\.get\(id\) !== session\) return session;/);
});

test('renderer durably saves a new session id before asking the PTY host to spawn it', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const persist = renderer.indexOf('await persistWorkspaceNow({ required: true });', renderer.indexOf('async function addSession('));
  const spawn = renderer.indexOf('const details = await api.createSession', persist);

  assert.ok(persist >= 0);
  assert.ok(spawn > persist);
  assert.match(renderer, /if \(restoringWorkspace && !options\.required\) return Promise\.resolve\(\);/);
  assert.match(renderer, /if \(restoringWorkspace && !options\.id\) await workspaceRestoreComplete;/);
  assert.match(renderer, /finally \{\s*restoringWorkspace = false;\s*resolveWorkspaceRestore\(\);\s*\}/);
  assert.match(renderer, /persistWorkspaceCopies\(durableWorkspace\.serialized, \{[\s\S]*?required,[\s\S]*?return durableSave;/);
  assert.match(renderer, /const enqueueWorkspacePersistence = createSerializedAsyncQueue\(\);[\s\S]*?function persistWorkspaceNow\(options = \{\}\)[\s\S]*?enqueueWorkspacePersistence\(\(\) => persistWorkspaceSnapshot\(options\)\)/);
  assert.match(renderer, /function acknowledgeTerminalDataAfterCheckpoint\(id, hostGeneration, outputRevision, acknowledge\) \{\s*pendingTerminalCheckpointAcknowledgements\.push\(\{[\s\S]*?id, hostGeneration: String\(hostGeneration \|\| ''\), outputRevision, acknowledge/);
  assert.match(renderer, /const acknowledgementGroups = groupTerminalCheckpointAcknowledgements\(acknowledgements\);[\s\S]*?for \(const \{ id, acknowledgements: sessionAcknowledgements \} of acknowledgementGroups\)[\s\S]*?protectedCheckpointSessionIds: new Set\(\[id\]\)[\s\S]*?unsatisfied\.push\(\.\.\.sessionAcknowledgements\)/);
  assert.match(renderer, /finally \{\s*restoringWorkspace = false;\s*resolveWorkspaceRestore\(\);\s*\}[\s\S]*?if \(pendingTerminalCheckpointAcknowledgements\.length > 0\) \{\s*await flushTerminalCheckpointAcknowledgements\(\{ forceSave: true \}\);/);
  assert.match(renderer, /cursorBlink: false,\s*disableStdin: true,/);
  assert.match(renderer, /const serializeAddon = new SerializeAddon\(\);[\s\S]*?terminal\.loadAddon\(serializeAddon\)/);
  assert.match(renderer, /const terminalCheckpoint = serializedTerminalCheckpoint\(session\);[\s\S]*?terminalState: terminalCheckpoint\.state,\s*mobileTerminalState: terminalCheckpoint\.mobileState,\s*terminalStateCols: session\.terminal\.cols,\s*terminalStateRows: session\.terminal\.rows,\s*hostGeneration: terminalCheckpoint\.hostGeneration,\s*durableOutputRevision: terminalCheckpoint\.outputRevision/);
  assert.match(renderer, /const checkpointSidecars = new Map\(\);[\s\S]*?for \(const id of protectedCheckpointSessionIds\)[\s\S]*?await api\.saveTerminalCheckpoint\(checkpoint\);[\s\S]*?serializeWorkspaceWithinBudget\(workspaceRecord\)/);
  assert.match(renderer, /serializeAddon\.serialize\(\{ scrollback: LIVE_TERMINAL_SCROLLBACK_LINES \}\)/);
  assert.match(renderer, /for \(const id of restoreOrder\)[\s\S]*?const saved = applyTerminalCheckpointBackups\(\s*\{ sessions: \[savedDescriptor\] \}, api\.getTerminalCheckpointSync\(id\)\s*\)[\s\S]*?await addSession/);
  assert.match(renderer, /const restoredTerminalState = decodeTerminalState\(options\.terminalState\);[\s\S]*?const details = await api\.createSession[\s\S]*?const canRestoreTerminalState = Boolean\(restoredTerminalState[\s\S]*?nextHostGeneration === savedHostGeneration[\s\S]*?details\.reattached \|\| details\.exited[\s\S]*?terminal\.write\(restoredTerminalState, resolve\)[\s\S]*?safeHistory/);
  assert.match(renderer, /checkpointGeneration: session\.hostGeneration,\s*checkpointRevision: session\.durableOutputRevision/);
  assert.match(renderer, /checkpointRevision: session\.durableOutputRevision,\s*terminalState: restoredTerminalState/);
  assert.match(renderer, /async function closeSession\(id, \{ ensureSession = true \} = \{\}\)[\s\S]*?await api\.close\(id\)[\s\S]*?sessions\.delete\(id\)/);
  assert.match(main, /await session\.processHandle\.kill\(\);\s*\} catch \(error\) \{\s*if \(session\.windowsHosted\) throw error;/);
  assert.match(renderer, /function serializedTerminalCheckpoint\(session\) \{\s*if \(!session\.hostGeneration\)[\s\S]*?state: '', mobileState: ''/);
  assert.match(renderer, /async function deleteGroup\(groupId\)[\s\S]*?await closeSession\(sessionId, \{ ensureSession: false \}\)[\s\S]*?if \(!allClosed\) return;[\s\S]*?groups = groups\.filter/);
  assert.match(main, /terminalSessionDrainActive = true;[\s\S]*?await Promise\.allSettled\(\[\.\.\.pendingTerminalCloseOperations\]\)[\s\S]*?detachAllSessionsPromise = null/);
  assert.match(main, /ipcMain\.handle\('terminal:close'[\s\S]*?if \(terminalSessionDrainActive\) throw new Error/);
  assert.match(renderer, /session\.terminal\.write\(data, \(\) => \{[\s\S]*?session\.durableOutputRevision = Math\.max\(session\.durableOutputRevision, outputRevision\);[\s\S]*?acknowledgeTerminalDataAfterCheckpoint\(id, hostGeneration, outputRevision, acknowledge\)/);
  assert.match(renderer, /terminal\.onData\(\(data\) => \{\s*if \(session\.exited \|\| session\.connecting\) return;/);
  assert.match(renderer, /await api\.markRendererReady\(id\);[\s\S]*?if \(!details\.exited\) \{\s*session\.connecting = false;\s*terminal\.options\.disableStdin = false;\s*api\.resize\(id, terminal\.cols, terminal\.rows\);/);
});
