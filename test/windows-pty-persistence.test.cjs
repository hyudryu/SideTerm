const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  connectWindowsPtyHost,
  validMetadata,
  WindowsPtyHandle,
  WindowsPtyHostClient
} = require('../electron/sessions/windows-pty-client.cjs');
const { createOutputFlowControl } = require('../electron/sessions/output-flow-control.cjs');

function fakeSocket() {
  const listeners = new Map();
  return {
    destroyed: false,
    writes: [],
    on(event, listener) {
      const entries = listeners.get(event) || [];
      entries.push(listener);
      listeners.set(event, entries);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) || []) listener(...args);
    },
    write(data) {
      this.writes.push(JSON.parse(String(data).trim()));
    },
    end() {},
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('close');
    }
  };
}

function waitForOutput(handle, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let subscription = null;
    const timer = setTimeout(() => {
      subscription?.dispose();
      reject(new Error(`Timed out waiting for PTY output matching ${pattern}. Received: ${output}`));
    }, timeoutMs);
    subscription = handle.onData((data) => {
      output += data;
      if (!pattern.test(output)) return;
      clearTimeout(timer);
      subscription?.dispose();
      resolve(output);
    });
  });
}

function waitForExit(handle, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let subscription = null;
    const timer = setTimeout(() => {
      subscription?.dispose();
      reject(new Error('Timed out waiting for the PTY to exit.'));
    }, timeoutMs);
    subscription = handle.onExit((event) => {
      clearTimeout(timer);
      subscription?.dispose();
      resolve(event);
    });
  });
}

test('PTY host metadata accepts only authenticated SideTerm named pipes', () => {
  assert.equal(validMetadata({
    protocol: 1,
    pid: 42,
    pipeName: '\\\\.\\pipe\\sideterm-pty-test',
    token: 'a'.repeat(64)
  }), true);
  assert.equal(validMetadata({
    protocol: 1,
    pid: 42,
    pipeName: '\\\\.\\pipe\\untrusted',
    token: 'a'.repeat(64)
  }), false);
});

test('hosted PTY handles satisfy output flow control with remote pause and resume commands', () => {
  const commands = [];
  const client = { command: (payload) => commands.push(payload), handles: new Map() };
  const handle = new WindowsPtyHandle(client, {
    id: 'flow-session', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace'
  });
  const flow = createOutputFlowControl(handle, { highWaterBytes: 100, lowWaterBytes: 25 });

  flow.accept(100);
  flow.accept(100);
  flow.acknowledge(175);

  assert.deepEqual(commands, [
    { action: 'pause', id: 'flow-session' },
    { action: 'resume', id: 'flow-session' }
  ]);
});

test('exit events received before handle registration are delivered after creation', async () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  const handlePromise = client.createSession({ id: 'instant-exit' });
  const requestId = socket.writes[0].requestId;
  socket.emit('data', [
    { type: 'response', requestId, result: {
      id: 'instant-exit', pid: 43, shell: 'powershell.exe', cwd: 'C:\\workspace'
    } },
    { type: 'data', id: 'instant-exit', data: Buffer.from('last output').toString('base64') },
    { type: 'exit', id: 'instant-exit', exitCode: 7, signal: 0 }
  ].map((message) => JSON.stringify(message)).join('\n') + '\n');

  const handle = await handlePromise;
  let data = '';
  let exit = null;
  handle.onData((chunk) => { data += chunk; });
  handle.onExit((event) => { exit = event; });

  assert.equal(data, 'last output');
  assert.deepEqual(exit, { exitCode: 7, signal: 0 });
  assert.equal(client.handles.has('instant-exit'), false);
  assert.equal(client.orphanExits.has('instant-exit'), false);
});

test('collected exit tombstones are acknowledged only after replay and exit delivery', async () => {
  const commands = [];
  const client = {
    command: (payload) => commands.push(payload),
    handles: new Map(),
    orphanData: new Map(),
    orphanExits: new Map(),
    request: async () => ({
      id: 'exited-session',
      pid: 44,
      shell: 'powershell.exe',
      cwd: 'C:\\workspace',
      replay: Buffer.from('final output').toString('base64'),
      exited: true,
      exitCode: 9,
      signal: 0,
      exitClaimToken: 'claim-token'
    })
  };

  const handle = await WindowsPtyHostClient.prototype.createSession.call(client, {});
  let exit = null;
  handle.onExit((event) => { exit = event; });
  assert.deepEqual(commands, []);
  let output = '';
  handle.onData((data) => { output += data; });

  assert.equal(output, 'final output');
  assert.deepEqual(exit, { exitCode: 9, signal: 0 });
  assert.deepEqual(commands, [{
    action: 'ack-exited', id: 'exited-session', claimToken: 'claim-token'
  }]);
});

test('PTY client close notifications are idempotent and support late subscribers', () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  let notifications = 0;
  client.onClose(() => { notifications += 1; });

  socket.emit('close');
  socket.emit('close');
  client.onClose(() => { notifications += 1; });

  assert.equal(notifications, 2);
  assert.equal(client.closed, true);
});

test('main invalidates both cached PTY host references when their client closes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /client\.onClose\(\(\) => \{\s*if \(windowsPtyHostClient === client\) windowsPtyHostClient = null;\s*if \(windowsPtyHostConnection === connection\) windowsPtyHostConnection = null;/);
});

test('Windows shell overrides are resolved before they cross the PTY host boundary', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const host = fs.readFileSync(path.join(__dirname, '..', 'electron', 'sessions', 'windows-pty-host.cjs'), 'utf8');
  assert.match(main, /if \(override && fs\.existsSync\(override\)\) return path\.resolve\(override\);/);
  assert.match(host, /path\.win32\.basename\(executable\) === executable/);
  assert.match(host, /message\.action === 'pause'[\s\S]*?processHandle\.pause\(\)[\s\S]*?message\.action === 'resume'[\s\S]*?processHandle\.resume\(\)/);
  assert.match(host, /releasePausedSessions\(socket\)/);
  assert.match(host, /const MAX_EXITED_SESSIONS = 20/);
  assert.match(host, /exitClaimToken: exited\.claimToken/);
});

test('a failed connection to live host metadata does not replace it', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-live-host-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const metadata = {
    protocol: 1,
    pid: process.pid,
    pipeName: `\\\\.\\pipe\\sideterm-pty-unresponsive-${process.pid}`,
    token: 'b'.repeat(64)
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  await assert.rejects(connectWindowsPtyHost({
    metadataPath,
    hostScript: path.join(temporaryDirectory, 'must-not-launch.cjs'),
    executablePath: process.execPath,
    timeoutMs: 150
  }));

  assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, 'utf8')), metadata);
});

test('detached PTY host preserves a live session across client restarts', {
  timeout: 20_000,
  skip: process.platform !== 'win32'
}, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-pty-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const hostScript = path.join(__dirname, '..', 'electron', 'sessions', 'windows-pty-host.cjs');
  let client = null;
  let handle = null;

  t.after(async () => {
    try {
      handle?.kill();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await client?.shutdownIfIdle();
    } catch {
      // Best-effort cleanup for a failed integration assertion.
    }
    client?.disconnect();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const childScript = [
    "process.stdin.setEncoding('utf8')",
    "process.stdout.write('HOST_READY\\n')",
    "setTimeout(() => process.stdout.write('WHILE_DETACHED\\n'), 500)",
    "process.stdin.on('data', (data) => { if (data.includes('EXIT_WHILE_DETACHED')) { process.stdout.write('EXIT_SCHEDULED\\n'); setTimeout(() => { process.stdout.write('FINAL_DETACHED\\n'); process.exit(9); }, 200); } else { process.stdout.write('HOST_ECHO:' + data); } })",
    'setInterval(() => {}, 1000)'
  ].join(';');
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path';
  const options = {
    id: 'persistent-session',
    executable: path.basename(process.execPath),
    args: ['-e', childScript],
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: temporaryDirectory,
    env: {
      SIDETERM_TEST_ENV: '1',
      [pathKey]: `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] || ''}`
    }
  };

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  await waitForOutput(handle, /HOST_READY/);
  const originalPid = handle.pid;
  assert.equal(handle.reattached, false);

  client.disconnect();
  client = null;
  handle = null;
  await new Promise((resolve) => setTimeout(resolve, 750));

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.reattached, true);
  assert.equal(handle.pid, originalPid);
  await waitForOutput(handle, /WHILE_DETACHED/);

  const echoed = waitForOutput(handle, /HOST_ECHO:hello/);
  handle.write(`hello${os.EOL}`);
  await echoed;

  handle.pause();
  await new Promise((resolve) => setTimeout(resolve, 100));
  client.disconnect();
  client = null;
  handle = null;
  await new Promise((resolve) => setTimeout(resolve, 100));

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);
  const afterPausedDisconnect = waitForOutput(handle, /HOST_ECHO:after-pause/);
  handle.write(`after-pause${os.EOL}`);
  await afterPausedDisconnect;

  const exitScheduled = waitForOutput(handle, /EXIT_SCHEDULED/);
  handle.write(`EXIT_WHILE_DETACHED${os.EOL}`);
  await exitScheduled;
  client.disconnect();
  client = null;
  handle = null;
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);
  assert.match(await waitForOutput(handle, /FINAL_DETACHED/), /FINAL_DETACHED/);
  assert.deepEqual(await waitForExit(handle), { exitCode: 9, signal: 0 });
});
