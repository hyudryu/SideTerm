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

test('renderer reload replay buffer remains bounded', () => {
  const session = {};
  bufferRendererOutput(session, 'abcdef', 4);
  assert.equal(session.rendererReplay, 'cdef');
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

  assert.match(main, /if \(session\.rendererAttached && terminalRendererCanAcknowledge\(\)\) \{[\s\S]*?sendTerminalData\(id, data, session\.rendererFlow\);[\s\S]*?\} else \{\s*bufferRendererOutput\(session, data\);/);
  assert.match(main, /ipcMain\.handle\('terminal:renderer-ready'[\s\S]*?markTerminalRendererReady/);
  assert.match(preload, /markRendererReady: \(id\) => ipcRenderer\.invoke\('terminal:renderer-ready', id\)/);
  assert.match(renderer, /const details = await api\.createSession[\s\S]*?await api\.markRendererReady\(id\);/);
});
