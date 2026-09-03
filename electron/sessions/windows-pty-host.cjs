const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const pty = require('node-pty');
const { dispatchPtyCommand } = require('./pty-command-dispatch.cjs');

const metadataPath = process.env.SIDETERM_PTY_HOST_METADATA;
const pipeName = process.env.SIDETERM_PTY_HOST_PIPE;
const authToken = process.env.SIDETERM_PTY_HOST_TOKEN;

if (!metadataPath || !pipeName || !authToken) {
  process.exitCode = 2;
  throw new Error('SideTerm PTY host configuration is incomplete.');
}

const clients = new Set();
const sessions = new Map();
const exitedSessions = new Map();
const MAX_EXITED_SESSIONS = 20;
const EXITED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const HOST_BUFFER_HIGH_WATER_CHARACTERS = 250_000;
let idleTimer = null;

function send(socket, payload) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(payload)}\n`);
}

function response(socket, requestId, result, error = '') {
  send(socket, { type: 'response', requestId, result, error });
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

function leaseSessionReplay(session) {
  if (session.replayLease) return session.replayLease;
  const replay = session.detachedOutput;
  if (!replay) return null;
  session.detachedOutput = '';
  session.replayLease = {
    token: crypto.randomUUID(),
    data: replay,
    outputRevision: session.outputRevision
  };
  return session.replayLease;
}

function validCheckpointRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function applySessionCheckpoint(session, generation, revision) {
  if (String(generation || '') !== session.generation || !validCheckpointRevision(revision)) return;
  const checkpoint = Math.min(revision, session.outputRevision);
  if (checkpoint <= session.checkpointRevision) return;
  session.checkpointRevision = checkpoint;
  if (session.replayLease && checkpoint >= session.replayLease.outputRevision) session.replayLease = null;
  if (checkpoint >= session.outputRevision) session.detachedOutput = '';
}

function updateBufferedOutputBackpressure(session) {
  const shouldPause = session.detachedOutput.length >= HOST_BUFFER_HIGH_WATER_CHARACTERS;
  if (shouldPause === session.bufferPaused) return;
  session.bufferPaused = shouldPause;
  try {
    if (shouldPause) {
      if (session.pausedClients.size === 0) session.processHandle.pause();
    } else if (session.pausedClients.size === 0) {
      session.processHandle.resume();
    }
  } catch {
    // The process may already be exiting.
  }
}

function deliverAttachedReplay(id, session) {
  if (session.replayLease || !session.detachedOutput) return false;
  const recipients = [...session.attachedClients]
    .filter((socket) => socket.sideTermReplayAcknowledgements);
  if (recipients.length === 0) return false;
  const replayLease = leaseSessionReplay(session);
  updateBufferedOutputBackpressure(session);
  for (const socket of recipients) {
    send(socket, {
      type: 'replay', id, generation: session.generation,
      data: Buffer.from(replayLease.data, 'utf8').toString('base64'),
      replayClaimToken: replayLease.token,
      outputRevision: replayLease.outputRevision
    });
  }
  return true;
}

function sessionResult(id, session, reattached, socket) {
  if (!socket?.sideTermReplayAcknowledgements) {
    const replay = `${session.replayLease?.data || ''}${session.detachedOutput || ''}`;
    session.replayLease = null;
    session.detachedOutput = '';
    session.checkpointRevision = session.outputRevision;
    session.attachedClients.add(socket);
    updateBufferedOutputBackpressure(session);
    return {
      id,
      pid: session.processHandle.pid,
      cwd: session.cwd,
      shell: session.shell,
      generation: session.generation,
      reattached: Boolean(reattached),
      replay: replay ? Buffer.from(replay, 'utf8').toString('base64') : ''
    };
  }
  const replayLease = leaseSessionReplay(session);
  session.attachedClients.add(socket);
  updateBufferedOutputBackpressure(session);
  return {
    id,
    pid: session.processHandle.pid,
    cwd: session.cwd,
    shell: session.shell,
    generation: session.generation,
    reattached: Boolean(reattached),
    replay: replayLease?.data ? Buffer.from(replayLease.data, 'utf8').toString('base64') : '',
    replayClaimToken: replayLease?.token || '',
    outputRevision: replayLease?.outputRevision || session.checkpointRevision
  };
}

function pruneExitedSessions(now = Date.now()) {
  for (const [id, exited] of exitedSessions) {
    if (now - exited.exitedAt >= EXITED_SESSION_TTL_MS) exitedSessions.delete(id);
  }
  while (exitedSessions.size > MAX_EXITED_SESSIONS) {
    exitedSessions.delete(exitedSessions.keys().next().value);
  }
}

function retainExitedSession(id, session, exitCode, signal) {
  exitedSessions.delete(id);
  exitedSessions.set(id, {
    id,
    pid: session.processHandle.pid,
    cwd: session.cwd,
    shell: session.shell,
    generation: session.generation,
    replayLeaseData: session.replayLease?.data || '',
    replayLeaseRevision: session.replayLease?.outputRevision || session.checkpointRevision,
    detachedOutput: session.detachedOutput,
    outputRevision: session.outputRevision,
    checkpointRevision: session.checkpointRevision,
    exitCode,
    signal,
    exitedAt: Date.now(),
    claimToken: crypto.randomUUID()
  });
  pruneExitedSessions();
}

function applyExitedCheckpoint(exited, generation, revision) {
  if (String(generation || '') !== exited.generation || !validCheckpointRevision(revision)) return;
  exited.checkpointRevision = Math.max(
    exited.checkpointRevision,
    Math.min(revision, exited.outputRevision)
  );
}

function exitedReplay(exited) {
  const leased = exited.checkpointRevision < exited.replayLeaseRevision
    ? exited.replayLeaseData
    : '';
  const detached = exited.checkpointRevision < exited.outputRevision
    ? exited.detachedOutput
    : '';
  return `${leased}${detached}`;
}

function exitedSessionResult(exited) {
  const replay = exitedReplay(exited);
  return {
    id: exited.id,
    pid: exited.pid,
    cwd: exited.cwd,
    shell: exited.shell,
    generation: exited.generation,
    reattached: true,
    replay: replay ? Buffer.from(replay, 'utf8').toString('base64') : '',
    outputRevision: exited.outputRevision,
    exited: true,
    exitCode: exited.exitCode,
    signal: exited.signal,
    exitClaimToken: exited.claimToken
  };
}

function createSession(input, socket) {
  const id = String(input?.id || '');
  if (!id || id.length > 100) throw new Error('A valid session id is required.');
  const dimensions = safeDimensions(input.cols, input.rows);
  pruneExitedSessions();
  const existing = sessions.get(id);
  if (existing) {
    applySessionCheckpoint(existing, input.checkpointGeneration, input.checkpointRevision);
    try {
      existing.processHandle.resize(dimensions.cols, dimensions.rows);
    } catch {
      // An exit may already be queued; return the handle so the client can
      // observe that exit instead of spawning a replacement process.
    }
    return sessionResult(id, existing, true, socket);
  }
  const exited = exitedSessions.get(id);
  if (exited) {
    applyExitedCheckpoint(exited, input.checkpointGeneration, input.checkpointRevision);
    return exitedSessionResult(exited);
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
    generation: crypto.randomUUID(),
    detachedOutput: '',
    replayLease: null,
    outputRevision: 0,
    checkpointRevision: 0,
    bufferPaused: false,
    attachedClients: new Set(),
    pausedClients: new Set()
  };
  sessions.set(id, session);
  processHandle.onData((data) => {
    session.outputRevision += 1;
    session.detachedOutput = `${session.detachedOutput}${data}`;
    updateBufferedOutputBackpressure(session);
    let deliveredToLegacyClient = false;
    for (const socket of session.attachedClients) {
      if (!socket.sideTermReplayAcknowledgements) {
        send(socket, {
          type: 'data', id, generation: session.generation,
          data: Buffer.from(data, 'utf8').toString('base64')
        });
        deliveredToLegacyClient = true;
      }
    }
    const deliveredReplay = deliverAttachedReplay(id, session);
    if (deliveredToLegacyClient && !deliveredReplay && !session.replayLease) {
      session.detachedOutput = '';
      session.checkpointRevision = session.outputRevision;
    }
    updateBufferedOutputBackpressure(session);
  });
  processHandle.onExit(({ exitCode, signal }) => {
    if (sessions.get(id) !== session) return;
    const normalizedExitCode = Number(exitCode);
    const normalizedSignal = Number(signal) || 0;
    sessions.delete(id);
    const tail = session.detachedOutput;
    retainExitedSession(id, session, normalizedExitCode, normalizedSignal);
    const exited = exitedSessions.get(id);
    for (const socket of clients) {
      send(socket, {
        type: 'exit', id, generation: session.generation,
        replay: socket.sideTermReplayAcknowledgements && tail
          ? Buffer.from(tail, 'utf8').toString('base64')
          : '',
        outputRevision: session.outputRevision,
        exitCode: normalizedExitCode, signal: normalizedSignal,
        exitClaimToken: exited.claimToken
      });
    }
    scheduleIdleExit();
  });
  return sessionResult(id, session, false, socket);
}

function handleCommand(socket, message) {
  const id = String(message?.id || '');
  if (message.action === 'ack-exited') {
    const exited = exitedSessions.get(id);
    if (exited?.generation === String(message.generation || '')
      && exited.claimToken === String(message.claimToken || '')) {
      exitedSessions.delete(id);
      scheduleIdleExit();
    }
    return;
  }
  if (message.action === 'checkpoint') {
    const generation = String(message.generation || '');
    const exited = exitedSessions.get(id);
    if (exited?.generation === generation) {
      applyExitedCheckpoint(exited, generation, message.outputRevision);
      return;
    }
    const checkpointedSession = sessions.get(id);
    if (checkpointedSession?.generation !== generation) return;
    applySessionCheckpoint(checkpointedSession, generation, message.outputRevision);
    checkpointedSession.attachedClients.add(socket);
    deliverAttachedReplay(id, checkpointedSession);
    updateBufferedOutputBackpressure(checkpointedSession);
    return;
  }
  const session = sessions.get(id);
  if (!session) return;
  if (message.generation && message.generation !== session.generation) return;
  if (message.action === 'ack-replay') {
    if (session.replayLease?.token !== String(message.claimToken || '')) return;
    session.checkpointRevision = Math.max(
      session.checkpointRevision,
      session.replayLease.outputRevision
    );
    session.replayLease = null;
    session.attachedClients.add(socket);
    deliverAttachedReplay(id, session);
    updateBufferedOutputBackpressure(session);
    return;
  }
  if (message.action === 'write') {
    session.processHandle.write(Buffer.from(String(message.data || ''), 'base64').toString('utf8'));
  } else if (message.action === 'resize') {
    const dimensions = safeDimensions(message.cols, message.rows);
    session.processHandle.resize(dimensions.cols, dimensions.rows);
  } else if (message.action === 'kill') {
    killSession(id, message.generation);
  } else if (message.action === 'pause') {
    if (session.pausedClients.size === 0) session.processHandle.pause();
    session.pausedClients.add(socket);
  } else if (message.action === 'resume') {
    const released = session.pausedClients.delete(socket);
    if (released && session.pausedClients.size === 0 && !session.bufferPaused) session.processHandle.resume();
  }
}

function killSession(id, generation = '') {
  const session = sessions.get(id);
  if (!session) {
    const exited = exitedSessions.get(id);
    if (exited && exited.generation !== generation) {
      throw new Error('The terminal generation changed before it could be closed.');
    }
    if (exited) {
      exitedSessions.delete(id);
      scheduleIdleExit();
    }
    return { killed: false };
  }
  if (generation !== session.generation) {
    throw new Error('The terminal generation changed before it could be closed.');
  }
  session.closing = true;
  sessions.delete(id);
  try {
    session.processHandle.kill();
  } catch (error) {
    session.closing = false;
    sessions.set(id, session);
    throw error;
  }
  scheduleIdleExit();
  return { killed: true };
}

function handleRequest(socket, message) {
  const requestId = String(message.requestId || '');
  if (!requestId) return;
  try {
    if (message.action === 'create') {
      response(socket, requestId, createSession(message.session, socket));
      return;
    }
    if (message.action === 'kill') {
      response(socket, requestId, killSession(
        String(message.id || ''), String(message.generation || '')
      ));
      return;
    }
    if (message.action === 'shutdown-if-idle') {
      pruneExitedSessions();
      const idle = sessions.size === 0 && exitedSessions.size === 0;
      response(socket, requestId, { idle });
      if (idle) setTimeout(shutdownIfStillIdle, 10).unref();
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
    socket.sideTermReplayAcknowledgements = message?.capabilities?.replayAcknowledgements === true;
    cancelIdleExit();
    clients.add(socket);
    send(socket, { type: 'authenticated', protocol: 1, pid: process.pid });
    return;
  }
  if (message?.type === 'request') handleRequest(socket, message);
  if (message?.type === 'command') dispatchPtyCommand(handleCommand, socket, message);
}

function cancelIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function exitIfStillIdle() {
  idleTimer = null;
  pruneExitedSessions();
  if (sessions.size > 0 || clients.size > 0 || exitedSessions.size > 0) {
    scheduleIdleExit();
    return;
  }
  cleanExit();
}

function shutdownIfStillIdle() {
  pruneExitedSessions();
  if (sessions.size === 0 && exitedSessions.size === 0) cleanExit();
}

function releasePausedSessions(socket) {
  for (const session of sessions.values()) {
    session.attachedClients.delete(socket);
    if (!session.pausedClients.delete(socket) || session.pausedClients.size > 0 || session.bufferPaused) continue;
    try {
      session.processHandle.resume();
    } catch {
      // The process may already have exited.
    }
  }
}

function scheduleIdleExit() {
  cancelIdleExit();
  pruneExitedSessions();
  if (sessions.size > 0 || clients.size > 0) return;
  if (exitedSessions.size > 0) {
    const oldest = exitedSessions.values().next().value;
    const remaining = Math.max(1, EXITED_SESSION_TTL_MS - (Date.now() - oldest.exitedAt));
    idleTimer = setTimeout(scheduleIdleExit, remaining);
    idleTimer.unref();
    return;
  }
  idleTimer = setTimeout(exitIfStillIdle, 5_000);
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
