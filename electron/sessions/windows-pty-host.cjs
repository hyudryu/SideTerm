const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const pty = require('node-pty');

const metadataPath = process.env.SIDETERM_PTY_HOST_METADATA;
const pipeName = process.env.SIDETERM_PTY_HOST_PIPE;
const authToken = process.env.SIDETERM_PTY_HOST_TOKEN;

if (!metadataPath || !pipeName || !authToken) {
  process.exitCode = 2;
  throw new Error('SideTerm PTY host configuration is incomplete.');
}

const clients = new Set();
const sessions = new Map();
let idleTimer = null;

function send(socket, payload) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(payload)}\n`);
}

function response(socket, requestId, result, error = '') {
  send(socket, { type: 'response', requestId, result, error });
}

function broadcast(payload) {
  for (const socket of clients) send(socket, payload);
}

function safeDimensions(cols, rows) {
  const width = Math.max(2, Math.floor(Number(cols) || 100));
  const height = Math.max(1, Math.floor(Number(rows) || 30));
  return { cols: width, rows: height };
}

function validExecutable(executable) {
  if (path.isAbsolute(executable)) return true;
  return Boolean(executable)
    && path.win32.basename(executable) === executable
    && executable !== '.'
    && executable !== '..';
}

function sessionResult(id, session, reattached) {
  const replay = session.detachedOutput || '';
  session.detachedOutput = '';
  return {
    id,
    pid: session.processHandle.pid,
    cwd: session.cwd,
    shell: session.shell,
    reattached: Boolean(reattached),
    replay: replay ? Buffer.from(replay, 'utf8').toString('base64') : ''
  };
}

function createSession(input) {
  const id = String(input?.id || '');
  if (!id || id.length > 100) throw new Error('A valid session id is required.');
  const dimensions = safeDimensions(input.cols, input.rows);
  const existing = sessions.get(id);
  if (existing) {
    existing.processHandle.resize(dimensions.cols, dimensions.rows);
    return sessionResult(id, existing, true);
  }

  const executable = String(input.executable || '');
  const cwd = String(input.cwd || '');
  if (!validExecutable(executable) || !path.isAbsolute(cwd)) {
    throw new Error('PTY executable must be absolute or PATH-resolvable, and the working directory must be absolute.');
  }
  const args = Array.isArray(input.args) ? input.args.map(String).slice(0, 100) : [];
  const envOverrides = input.env && typeof input.env === 'object'
    ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [String(key), String(value)]))
    : {};
  const childEnvironment = { ...process.env, ...envOverrides };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  delete childEnvironment.SIDETERM_PTY_HOST_METADATA;
  delete childEnvironment.SIDETERM_PTY_HOST_PIPE;
  delete childEnvironment.SIDETERM_PTY_HOST_TOKEN;
  const spawnOptions = {
    name: String(input.name || 'xterm-256color'),
    cols: dimensions.cols,
    rows: dimensions.rows,
    cwd,
    env: childEnvironment
  };
  if (process.platform === 'win32') spawnOptions.useConpty = true;
  const processHandle = pty.spawn(executable, args, spawnOptions);
  const session = {
    processHandle,
    cwd,
    shell: path.basename(executable),
    detachedOutput: '',
    pausedClients: new Set()
  };
  sessions.set(id, session);
  processHandle.onData((data) => {
    if (clients.size === 0) {
      session.detachedOutput = `${session.detachedOutput}${data}`.slice(-300_000);
    } else {
      broadcast({ type: 'data', id, data: Buffer.from(data, 'utf8').toString('base64') });
    }
  });
  processHandle.onExit(({ exitCode, signal }) => {
    if (sessions.get(id) !== session) return;
    sessions.delete(id);
    broadcast({ type: 'exit', id, exitCode, signal });
    scheduleIdleExit();
  });
  return sessionResult(id, session, false);
}

function handleCommand(socket, message) {
  const id = String(message?.id || '');
  const session = sessions.get(id);
  if (!session) return;
  if (message.action === 'write') {
    session.processHandle.write(Buffer.from(String(message.data || ''), 'base64').toString('utf8'));
  } else if (message.action === 'resize') {
    const dimensions = safeDimensions(message.cols, message.rows);
    session.processHandle.resize(dimensions.cols, dimensions.rows);
  } else if (message.action === 'kill') {
    sessions.delete(id);
    try {
      session.processHandle.kill();
    } catch {
      // The process may already be exiting.
    }
    scheduleIdleExit();
  } else if (message.action === 'pause') {
    if (session.pausedClients.size === 0) session.processHandle.pause();
    session.pausedClients.add(socket);
  } else if (message.action === 'resume') {
    const released = session.pausedClients.delete(socket);
    if (released && session.pausedClients.size === 0) session.processHandle.resume();
  }
}

function handleRequest(socket, message) {
  const requestId = String(message.requestId || '');
  if (!requestId) return;
  try {
    if (message.action === 'create') {
      response(socket, requestId, createSession(message.session));
      return;
    }
    if (message.action === 'shutdown-if-idle') {
      response(socket, requestId, { idle: sessions.size === 0 });
      if (sessions.size === 0) setTimeout(cleanExit, 10).unref();
      return;
    }
    throw new Error('Unsupported PTY host request.');
  } catch (error) {
    response(socket, requestId, null, String(error?.message || error));
  }
}

function handleMessage(socket, message) {
  if (!socket.sideTermAuthenticated) {
    const supplied = Buffer.from(String(message?.token || ''));
    const expected = Buffer.from(authToken);
    if (message?.type !== 'auth' || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      socket.destroy();
      return;
    }
    socket.sideTermAuthenticated = true;
    clients.add(socket);
    send(socket, { type: 'authenticated', protocol: 1, pid: process.pid });
    return;
  }
  if (message?.type === 'request') handleRequest(socket, message);
  if (message?.type === 'command') handleCommand(socket, message);
}

function releasePausedSessions(socket) {
  for (const session of sessions.values()) {
    if (!session.pausedClients.delete(socket) || session.pausedClients.size > 0) continue;
    try {
      session.processHandle.resume();
    } catch {
      // The process may already have exited.
    }
  }
}

function scheduleIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (sessions.size > 0 || clients.size > 0) return;
  idleTimer = setTimeout(cleanExit, 5_000);
  idleTimer.unref();
}

function cleanExit() {
  try {
    const current = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (current.pid === process.pid && current.token === authToken) fs.unlinkSync(metadataPath);
  } catch {
    // Stale or already-removed metadata is harmless.
  }
  process.exit(0);
}

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffered = '';
  socket.on('data', (chunk) => {
    buffered += chunk;
    if (buffered.length > 2 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line) {
        try {
          handleMessage(socket, JSON.parse(line));
        } catch {
          socket.destroy();
          return;
        }
      }
      newline = buffered.indexOf('\n');
    }
  });
  socket.on('close', () => {
    clients.delete(socket);
    releasePausedSessions(socket);
    scheduleIdleExit();
  });
  socket.on('error', () => {});
});

server.on('error', () => process.exit(3));
server.listen(pipeName, () => {
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  const temporary = `${metadataPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ protocol: 1, pipeName, token: authToken, pid: process.pid })}\n`, { mode: 0o600 });
  fs.renameSync(temporary, metadataPath);
});

process.on('SIGTERM', cleanExit);
process.on('SIGINT', cleanExit);
