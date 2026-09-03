const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
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
const { dispatchPtyCommand } = require('../electron/sessions/pty-command-dispatch.cjs');

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
    subscription = handle.onData((data, replayClaimToken) => {
      output += data;
      if (replayClaimToken) handle.acknowledgeReplay(replayClaimToken);
      if (!pattern.test(output)) return;
      clearTimeout(timer);
      subscription?.dispose();
      resolve(output);
    });
  });
}

function waitForUnacknowledgedOutput(handle, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let checkpoint = null;
    let subscription = null;
    const timer = setTimeout(() => {
      subscription?.dispose();
      reject(new Error(`Timed out waiting for unacknowledged PTY output matching ${pattern}. Received: ${output}`));
    }, timeoutMs);
    subscription = handle.onData((data, replayClaimToken, hostGeneration, outputRevision) => {
      output += data;
      if (replayClaimToken) {
        checkpoint = { replayClaimToken, hostGeneration, outputRevision };
      }
      if (!pattern.test(output)) {
        if (replayClaimToken) {
          handle.acknowledgeReplay(replayClaimToken);
          checkpoint = null;
        }
        return;
      }
      clearTimeout(timer);
      subscription?.dispose();
      resolve({ output, ...checkpoint });
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
    subscription = handle.onExit((event, exitClaimToken) => {
      if (exitClaimToken) handle.acknowledgeExitedSession(exitClaimToken);
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
    id: 'flow-session', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'flow-generation'
  });
  const flow = createOutputFlowControl(handle, { highWaterBytes: 100, lowWaterBytes: 25 });

  flow.accept(100);
  flow.accept(100);
  flow.acknowledge(175);

  assert.deepEqual(commands, [
    { action: 'pause', id: 'flow-session', generation: 'flow-generation' },
    { action: 'resume', id: 'flow-session', generation: 'flow-generation' }
  ]);
});

test('hosted PTY checkpoints are generation-scoped and clear covered local leases', () => {
  const commands = [];
  const client = { command: (payload) => commands.push(payload), handles: new Map() };
  const handle = new WindowsPtyHandle(client, {
    id: 'checkpoint-session', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace',
    generation: 'checkpoint-generation', replayClaimToken: 'old-lease', outputRevision: 11
  });

  handle.checkpoint(11);

  assert.equal(handle.replayClaimToken, '');
  assert.equal(handle.replayOutputRevision, 0);
  assert.deepEqual(commands, [{
    action: 'checkpoint', id: 'checkpoint-session', generation: 'checkpoint-generation', outputRevision: 11
  }]);
});

test('hosted PTY writes are chunked below the shared pipe frame limit', () => {
  const commands = [];
  const client = { command: (payload) => commands.push(payload), handles: new Map() };
  const handle = new WindowsPtyHandle(client, {
    id: 'paste-session', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'paste-generation'
  });
  const pasted = `${'x'.repeat((512 * 1024) - 1)}🙂${'y'.repeat(1_600_000)}`;

  handle.write(pasted);

  assert.ok(commands.length > 1);
  assert.ok(commands.every((command) => Buffer.byteLength(`${JSON.stringify({ type: 'command', ...command })}\n`) < 2 * 1024 * 1024));
  const decodedChunks = commands.map((command) => Buffer.from(command.data, 'base64').toString('utf8'));
  assert.ok(decodedChunks.every((chunk) => !chunk.includes('\uFFFD')));
  assert.equal(decodedChunks.join(''), pasted);
  assert.ok(commands.every((command) => command.action === 'write'
    && command.id === 'paste-session' && command.generation === 'paste-generation'));
});

test('killing a hosted PTY waits for the host acknowledgement before releasing its handle', async () => {
  const requests = [];
  let resolveKill;
  const client = {
    request(action, payload) {
      requests.push({ action, ...payload });
      return new Promise((resolve) => { resolveKill = resolve; });
    },
    handles: new Map()
  };
  const handle = new WindowsPtyHandle(client, {
    id: 'closed-session', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'closed-generation'
  });
  client.handles.set(handle.id, handle);
  handle.onData(() => {});
  handle.onExit(() => {});

  const firstKill = handle.kill();
  const duplicateKill = handle.kill();

  assert.deepEqual(requests, [{ action: 'kill', id: 'closed-session', generation: 'closed-generation' }]);
  assert.equal(client.handles.get(handle.id), handle);
  assert.equal(handle.dataListeners.size, 1);
  assert.equal(handle.exitListeners.size, 1);

  resolveKill({ killed: true });
  await Promise.all([firstKill, duplicateKill]);

  assert.equal(client.handles.has(handle.id), false);
  assert.equal(handle.dataListeners.size, 0);
  assert.equal(handle.exitListeners.size, 0);

  const replacement = new WindowsPtyHandle(client, {
    id: handle.id, pid: 43, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'new-generation'
  });
  client.handles.set(handle.id, replacement);
  handle.detach();
  handle.emitExit({ exitCode: 0, signal: 0 });
  assert.equal(client.handles.get(handle.id), replacement);
});

test('a rejected hosted PTY kill preserves the handle and can be retried', async () => {
  let requestCount = 0;
  const client = {
    request() {
      requestCount += 1;
      return requestCount === 1
        ? Promise.reject(new Error('host unavailable'))
        : Promise.resolve({ killed: true });
    },
    handles: new Map()
  };
  const handle = new WindowsPtyHandle(client, {
    id: 'retry-close', pid: 42, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'retry-generation'
  });
  client.handles.set(handle.id, handle);
  handle.onData(() => {});

  await assert.rejects(handle.kill(), /host unavailable/);
  assert.equal(client.handles.get(handle.id), handle);
  assert.equal(handle.dataListeners.size, 1);

  await handle.kill();
  assert.equal(requestCount, 2);
  assert.equal(client.handles.has(handle.id), false);
});

test('exit events received before handle registration are delivered after creation', async () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  const handlePromise = client.createSession({ id: 'instant-exit' });
  const requestId = socket.writes[0].requestId;
  socket.emit('data', [
    { type: 'response', requestId, result: {
      id: 'instant-exit', pid: 43, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'instant-generation'
    } },
    { type: 'data', id: 'instant-exit', generation: 'instant-generation', data: Buffer.from('last output').toString('base64') },
    {
      type: 'exit', id: 'instant-exit', generation: 'instant-generation', exitCode: 7, signal: 0,
      replay: Buffer.from('tail output').toString('base64'), exitClaimToken: 'instant-claim'
    }
  ].map((message) => JSON.stringify(message)).join('\n') + '\n');

  const handle = await handlePromise;
  let data = '';
  let exit = null;
  let exitClaimToken = '';
  handle.onData((chunk) => { data += chunk; });
  handle.onExit((event, claimToken) => {
    exit = event;
    exitClaimToken = claimToken;
  });

  assert.equal(data, 'last output');
  assert.deepEqual(exit, { exitCode: 7, signal: 0, outputRevision: 0, replay: 'tail output' });
  assert.equal(exitClaimToken, 'instant-claim');
  assert.equal(client.handles.has('instant-exit'), false);
  assert.equal(client.orphanExits.size, 0);
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
      generation: 'exited-generation',
      replay: Buffer.from('final output').toString('base64'),
      exited: true,
      exitCode: 9,
      signal: 0,
      exitClaimToken: 'claim-token'
    })
  };

  const handle = await WindowsPtyHostClient.prototype.createSession.call(client, {});
  let exit = null;
  let deliveredExitClaimToken = '';
  handle.onExit((event, exitClaimToken) => {
    exit = event;
    deliveredExitClaimToken = exitClaimToken;
  });
  assert.deepEqual(commands, []);
  let output = '';
  handle.onData((data) => { output += data; });

  assert.equal(output, 'final output');
  assert.deepEqual(exit, { exitCode: 9, signal: 0, outputRevision: 0 });
  assert.deepEqual(commands, []);
  handle.acknowledgeExitedSession(deliveredExitClaimToken);
  assert.deepEqual(commands, [{
    action: 'ack-exited', id: 'exited-session', generation: 'exited-generation', claimToken: 'claim-token'
  }]);
});

test('live replay is acknowledged only after its data listener receives the leased output', async () => {
  const commands = [];
  const client = {
    command: (payload) => commands.push(payload),
    handles: new Map(),
    orphanData: new Map(),
    orphanExits: new Map(),
    request: async () => ({
      id: 'replay-session',
      pid: 45,
      shell: 'powershell.exe',
      cwd: 'C:\\workspace',
      generation: 'replay-generation',
      replay: Buffer.from('leased output').toString('base64'),
      replayClaimToken: 'replay-token'
    })
  };

  const handle = await WindowsPtyHostClient.prototype.createSession.call(client, {});
  assert.deepEqual(commands, []);
  let output = '';
  let deliveredClaimToken = '';
  handle.onData((data, replayClaimToken) => {
    output += data;
    deliveredClaimToken = replayClaimToken;
  });

  assert.equal(output, 'leased output');
  assert.deepEqual(commands, []);
  handle.acknowledgeReplay(deliveredClaimToken);
  assert.deepEqual(commands, [{
    action: 'ack-replay', id: 'replay-session', generation: 'replay-generation', claimToken: 'replay-token'
  }]);
});

test('orphan replay frames retain claim metadata until the handle is registered', async () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  const commands = [];
  client.command = (payload) => commands.push(payload);
  client.request = async () => {
    client.handleMessage({
      type: 'replay', id: 'orphan-replay', generation: 'orphan-generation',
      data: Buffer.from('orphan output').toString('base64'),
      replayClaimToken: 'orphan-claim', outputRevision: 19
    });
    return {
      id: 'orphan-replay', pid: 46, shell: 'powershell.exe', cwd: 'C:\\workspace',
      generation: 'orphan-generation', replay: '', replayClaimToken: '', outputRevision: 0
    };
  };

  const handle = await client.createSession({ id: 'orphan-replay' });
  let delivery = null;
  handle.onData((data, replayClaimToken, hostGeneration, outputRevision) => {
    delivery = { data, replayClaimToken, hostGeneration, outputRevision };
  });

  assert.deepEqual(delivery, {
    data: 'orphan output', replayClaimToken: 'orphan-claim',
    hostGeneration: 'orphan-generation', outputRevision: 19
  });
  handle.acknowledgeReplay(delivery.replayClaimToken);
  assert.deepEqual(commands, [{
    action: 'ack-replay', id: 'orphan-replay', generation: 'orphan-generation',
    claimToken: 'orphan-claim'
  }]);
});

test('an exit from an older generation cannot terminate a replacement handle with the same id', () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  const handle = new WindowsPtyHandle(client, {
    id: 'reused-session', pid: 46, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'new-generation'
  });
  client.handles.set(handle.id, handle);
  let exit = null;
  handle.onExit((event) => { exit = event; });

  client.handleMessage({
    type: 'exit', id: 'reused-session', generation: 'old-generation', exitCode: 3, signal: 0,
    exitClaimToken: 'old-claim'
  });

  assert.equal(exit, null);
  assert.equal(client.handles.get('reused-session'), handle);
  assert.equal(client.orphanExits.size, 1);
});

test('a throwing PTY command is contained and later commands remain usable', () => {
  const socket = { destroyed: false };
  const completed = [];
  const handleCommand = (_socket, message) => {
    if (message.id === 'exiting-session') throw new Error('resize raced with exit');
    completed.push(message.id);
  };

  assert.equal(dispatchPtyCommand(handleCommand, socket, { action: 'resize', id: 'exiting-session' }), false);
  assert.equal(socket.destroyed, false);
  assert.equal(dispatchPtyCommand(handleCommand, socket, { action: 'write', id: 'live-session' }), true);
  assert.deepEqual(completed, ['live-session']);
});

test('PTY client close notifications are idempotent and support late subscribers', () => {
  const socket = fakeSocket();
  const client = new WindowsPtyHostClient(socket);
  const handle = new WindowsPtyHandle(client, {
    id: 'recoverable-session', pid: 47, shell: 'powershell.exe', cwd: 'C:\\workspace', generation: 'recoverable-generation'
  });
  client.handles.set(handle.id, handle);
  let exits = 0;
  handle.onExit(() => { exits += 1; });
  let notifications = 0;
  client.onClose(() => { notifications += 1; });

  socket.emit('close');
  socket.emit('close');
  client.onClose(() => { notifications += 1; });

  assert.equal(notifications, 2);
  assert.equal(client.closed, true);
  assert.equal(exits, 0);
  assert.equal(client.handles.size, 0);
});

test('main invalidates both cached PTY host references when their client closes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /client\.onClose\(\(\) => \{\s*if \(windowsPtyHostClient === client\) windowsPtyHostClient = null;\s*if \(windowsPtyHostConnection === connection\) windowsPtyHostConnection = null;/);
  assert.match(main, /if \(!client\.closedIntentionally\) recoverWindowsPtyHostSessions\(client\);/);
  assert.match(main, /function recoverWindowsPtyHostSessions\(client\)[\s\S]*?session\.processHandle\?\.client !== client[\s\S]*?sessions\.delete\(id\)[\s\S]*?mainWindow\.webContents\.reload\(\)/);
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
  assert.match(host, /generation: session\.generation/);
  assert.match(host, /message\.action === 'ack-replay'[\s\S]*?session\.replayLease = null/);
  assert.match(host, /session\.detachedOutput = `\$\{session\.detachedOutput\}\$\{data\}`;[\s\S]*?updateBufferedOutputBackpressure\(session\);[\s\S]*?deliverAttachedReplay\(id, session\)/);
  assert.match(host, /HOST_BUFFER_HIGH_WATER_CHARACTERS = 250_000[\s\S]*?session\.processHandle\.pause\(\)[\s\S]*?session\.processHandle\.resume\(\)/);
  assert.match(host, /function exitedReplay\(exited\)[\s\S]*?return `\$\{leased\}\$\{detached\}`;/);
  assert.match(host, /retainExitedSession\(id, session, normalizedExitCode, normalizedSignal\);[\s\S]*?type: 'exit'/);
  assert.match(host, /if \(message\?\.type === 'command'\) dispatchPtyCommand\(handleCommand, socket, message\);/);
  assert.match(host, /sideTermReplayAcknowledgements = message\?\.capabilities\?\.replayAcknowledgements === true/);
  assert.match(host, /cancelIdleExit\(\);\s*clients\.add\(socket\)/);
  assert.match(host, /function exitIfStillIdle\(\)[\s\S]*?sessions\.size > 0 \|\| clients\.size > 0 \|\| exitedSessions\.size > 0/);
  assert.match(host, /setTimeout\(shutdownIfStillIdle, 10\)/);
  assert.match(host, /if \(message\.action === 'kill'\) \{\s*response\(socket, requestId, killSession\(/);
  assert.match(host, /if \(generation !== session\.generation\) \{\s*throw new Error\('The terminal generation changed before it could be closed\.'/);
  assert.match(main, /ipcMain\.handle\('terminal:close'[\s\S]*?pendingTerminalCloseOperations\.add\(operation\)/);
  assert.match(main, /function detachAllSessions\(\)[\s\S]*?await Promise\.allSettled\(\[\.\.\.pendingTerminalCloseOperations\]\)[\s\S]*?disconnectWindowsPtyHost\(\)/);
});

test('a missing pipe is replaced even when stale metadata points to a reused live PID', {
  timeout: 15_000,
  skip: process.platform !== 'win32'
}, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-live-host-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const hostScript = path.join(__dirname, '..', 'electron', 'sessions', 'windows-pty-host.cjs');
  const metadata = {
    protocol: 1,
    pid: process.pid,
    pipeName: `\\\\.\\pipe\\sideterm-pty-unresponsive-${process.pid}`,
    token: 'b'.repeat(64)
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  let client = null;
  t.after(async () => {
    try {
      await client?.shutdownIfIdle();
    } catch {
      // Best-effort cleanup for a failed integration assertion.
    }
    client?.disconnect();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  client = await connectWindowsPtyHost({
    metadataPath,
    hostScript,
    executablePath: process.execPath,
    timeoutMs: 5_000
  });

  const replacement = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.notEqual(replacement.pipeName, metadata.pipeName);
  assert.notEqual(replacement.token, metadata.token);
});

test('an authenticating live endpoint timeout preserves its metadata', {
  timeout: 5_000,
  skip: process.platform !== 'win32'
}, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-auth-timeout-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const pipeName = `\\\\.\\pipe\\sideterm-pty-auth-timeout-${process.pid}-${Date.now()}`;
  const metadata = { protocol: 1, pid: process.pid, pipeName, token: 'c'.repeat(64) };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, resolve);
  });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await assert.rejects(connectWindowsPtyHost({
    metadataPath,
    hostScript: path.join(temporaryDirectory, 'must-not-launch.cjs'),
    executablePath: process.execPath,
    timeoutMs: 200
  }), /Timed out authenticating/);

  assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, 'utf8')), metadata);
});

test('an authenticated reconnect cancels the host idle-exit timer', {
  timeout: 15_000,
  skip: process.platform !== 'win32'
}, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-idle-reconnect-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const hostScript = path.join(__dirname, '..', 'electron', 'sessions', 'windows-pty-host.cjs');
  let client = null;
  let handle = null;
  t.after(async () => {
    try {
      await handle?.kill();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await client?.shutdownIfIdle();
    } catch {
      // Best-effort cleanup for a failed integration assertion.
    }
    client?.disconnect();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  client.disconnect();
  client = null;
  await new Promise((resolve) => setTimeout(resolve, 250));

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession({
    id: 'idle-reconnect-session',
    executable: process.execPath,
    args: ['-e', "process.stdin.setEncoding('utf8'); process.stdout.write('READY\\n'); process.stdin.on('data', data => process.stdout.write('ECHO:' + data)); setInterval(() => {}, 1000)"],
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: temporaryDirectory,
    env: {}
  });
  await waitForOutput(handle, /READY/);
  const hostPid = JSON.parse(fs.readFileSync(metadataPath, 'utf8')).pid;
  await new Promise((resolve) => setTimeout(resolve, 5_250));
  const echoed = waitForOutput(handle, /ECHO:still-alive/);
  handle.write(`still-alive${os.EOL}`);
  await echoed;
  assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).pid, hostPid);
});

test('detached PTY host preserves a live session across client restarts', {
  timeout: 30_000,
  skip: process.platform !== 'win32'
}, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-pty-test-'));
  const metadataPath = path.join(temporaryDirectory, 'host.json');
  const hostScript = path.join(__dirname, '..', 'electron', 'sessions', 'windows-pty-host.cjs');
  let client = null;
  let handle = null;

  t.after(async () => {
    try {
      await handle?.kill();
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
    "process.stdin.on('data', (data) => { if (data.includes('EXIT_BUFFER_BURST')) { process.stdout.write('EXIT_BURST_START\\n' + 'C'.repeat(350000) + 'EXIT_BUFFER_BURST_END\\n'); setTimeout(() => process.exit(13), 200); } else if (data.includes('EXIT_WHILE_DETACHED')) { process.stdout.write('EXIT_SCHEDULED\\n'); setTimeout(() => { process.stdout.write('FINAL_DETACHED\\n'); process.exit(9); }, 200); } else if (data.includes('BUFFER_BURST')) { process.stdout.write('B'.repeat(350000) + 'BUFFER_BURST_END\\n'); } else { process.stdout.write('HOST_ECHO:' + data); } })",
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

  client.disconnect();
  client = await connectWindowsPtyHost({
    metadataPath, hostScript, executablePath: process.execPath, replayAcknowledgements: false
  });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);
  const legacyBurst = waitForOutput(handle, /BUFFER_BURST_END/, 10_000);
  handle.write(`BUFFER_BURST${os.EOL}`);
  assert.match(await legacyBurst, /BUFFER_BURST_END/);

  client.disconnect();
  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);

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

  const unacknowledged = waitForUnacknowledgedOutput(handle, /HOST_ECHO:checkpoint-me/);
  handle.write(`checkpoint-me${os.EOL}`);
  const checkpoint = await unacknowledged;
  assert.match(checkpoint.output, /HOST_ECHO:checkpoint-me/);
  assert.equal(checkpoint.hostGeneration, handle.generation);
  assert.ok(checkpoint.outputRevision > 0);
  client.disconnect();
  client = null;
  handle = null;

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);
  assert.match(await waitForOutput(handle, /HOST_ECHO:checkpoint-me/), /HOST_ECHO:checkpoint-me/);

  const alreadySaved = waitForUnacknowledgedOutput(handle, /HOST_ECHO:already-saved/);
  handle.write(`already-saved${os.EOL}`);
  const savedCheckpoint = await alreadySaved;
  assert.equal(savedCheckpoint.hostGeneration, handle.generation);
  assert.ok(savedCheckpoint.outputRevision > checkpoint.outputRevision);
  client.disconnect();
  client = null;
  handle = null;

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession({
    ...options,
    checkpointGeneration: savedCheckpoint.hostGeneration,
    checkpointRevision: savedCheckpoint.outputRevision
  });
  assert.equal(handle.pid, originalPid);
  assert.equal(handle.pendingData, '');
  const afterCheckpoint = waitForOutput(handle, /HOST_ECHO:after-checkpoint/);
  handle.write(`after-checkpoint${os.EOL}`);
  assert.match(await afterCheckpoint, /HOST_ECHO:after-checkpoint/);

  const bufferAnchor = waitForUnacknowledgedOutput(handle, /HOST_ECHO:buffer-anchor/);
  handle.write(`buffer-anchor${os.EOL}`);
  const heldCheckpoint = await bufferAnchor;
  assert.ok(heldCheckpoint.replayClaimToken);
  handle.write(`BUFFER_BURST${os.EOL}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const bufferedBurst = waitForOutput(handle, /BUFFER_BURST_END/, 10_000);
  handle.acknowledgeReplay(heldCheckpoint.replayClaimToken);
  assert.match(await bufferedBurst, /BUFFER_BURST_END/);

  const exitBufferAnchor = waitForUnacknowledgedOutput(handle, /HOST_ECHO:exit-buffer-anchor/);
  handle.write(`exit-buffer-anchor${os.EOL}`);
  const heldExitCheckpoint = await exitBufferAnchor;
  assert.ok(heldExitCheckpoint.replayClaimToken);
  handle.write(`EXIT_BUFFER_BURST${os.EOL}`);
  client.disconnect();
  client = null;
  handle = null;
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  client = await connectWindowsPtyHost({ metadataPath, hostScript, executablePath: process.execPath });
  handle = await client.createSession(options);
  assert.equal(handle.pid, originalPid);
  const exitReplay = await waitForOutput(handle, /EXIT_BUFFER_BURST_END/, 10_000);
  const plainExitReplay = exitReplay.replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
  const payloadStart = plainExitReplay.lastIndexOf('EXIT_BURST_START') + 'EXIT_BURST_START'.length;
  const payloadEnd = plainExitReplay.indexOf('EXIT_BUFFER_BURST_END', payloadStart);
  const exitPayload = plainExitReplay.slice(payloadStart, payloadEnd).replace(/\s/g, '');
  assert.equal(payloadStart >= 'EXIT_BURST_START'.length, true);
  assert.equal(payloadEnd > payloadStart, true);
  assert.match(exitPayload, /^C+$/);
  // ConPTY may redraw wrapped cells, but neither boundary nor any produced payload may be truncated.
  assert.ok(exitPayload.length >= 350_000);
  const exit = await waitForExit(handle);
  assert.equal(exit.exitCode, 13);
  assert.equal(exit.signal, 0);
  assert.ok(exit.outputRevision > savedCheckpoint.outputRevision);
});
