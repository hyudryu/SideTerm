const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MAX_PTY_WRITE_BYTES = 512 * 1024;

function validMetadata(value) {
  return value
    && value.protocol === 1
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.pipeName === 'string'
    && value.pipeName.startsWith('\\\\.\\pipe\\sideterm-pty-')
    && typeof value.token === 'string'
    && /^[a-f0-9]{64}$/i.test(value.token);
}

function readMetadata(metadataPath) {
  try {
    const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return validMetadata(value) ? value : null;
  } catch {
    return null;
  }
}

function sameMetadata(left, right) {
  return Boolean(left && right
    && left.pid === right.pid
    && left.pipeName === right.pipeName
    && left.token === right.token);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function sessionKey(id, generation = '') {
  return `${String(id || '')}\0${String(generation || '')}`;
}

function send(socket, payload) {
  if (socket.destroyed) throw new Error('The Windows PTY host connection is closed.');
  socket.write(`${JSON.stringify(payload)}\n`);
}

function connectSocket(metadata, timeoutMs = 1_000, replayAcknowledgements = true) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(metadata.pipeName);
    socket.setEncoding('utf8');
    let connected = false;
    const timer = setTimeout(() => {
      const error = new Error(connected
        ? 'Timed out authenticating with the Windows PTY host.'
        : 'Timed out connecting to the Windows PTY host.');
      error.code = connected ? 'SIDETERM_PTY_AUTH_TIMEOUT' : 'SIDETERM_PTY_CONNECT_TIMEOUT';
      socket.destroy();
      reject(error);
    }, timeoutMs);
    let buffered = '';
    const fail = (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.once('error', fail);
    socket.on('data', function authenticate(chunk) {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      let message;
      try {
        message = JSON.parse(buffered.slice(0, newline));
      } catch (error) {
        fail(error);
        return;
      }
      if (message.type !== 'authenticated' || message.protocol !== 1 || Number(message.pid) !== metadata.pid) {
        fail(new Error('The Windows PTY host rejected the connection.'));
        return;
      }
      clearTimeout(timer);
      socket.off('error', fail);
      socket.off('data', authenticate);
      resolve({ socket, remainder: buffered.slice(newline + 1) });
    });
    socket.once('connect', () => {
      connected = true;
      send(socket, {
        type: 'auth', token: metadata.token,
        capabilities: { replayAcknowledgements }
      });
    });
  });
}

class WindowsPtyHandle {
  constructor(client, details) {
    this.client = client;
    this.id = details.id;
    this.pid = details.pid;
    this.process = details.shell;
    this.cwd = details.cwd;
    this.reattached = Boolean(details.reattached);
    this.generation = String(details.generation || '');
    this.replayClaimToken = String(details.replayClaimToken || '');
    this.replayOutputRevision = Number.isSafeInteger(details.outputRevision)
      ? details.outputRevision
      : 0;
    this.pendingReplayClaimToken = '';
    this.pendingReplayOutputRevision = 0;
    this.exitClaimToken = String(details.exitClaimToken || '');
    this.exitDelivered = false;
    this.dataListeners = new Set();
    this.exitListeners = new Set();
    this.pendingData = '';
    this.pendingExit = null;
  }

  onData(listener) {
    this.dataListeners.add(listener);
    if (this.pendingData || this.pendingReplayClaimToken) {
      const data = this.pendingData;
      const replayClaimToken = this.pendingReplayClaimToken;
      const outputRevision = this.pendingReplayOutputRevision;
      this.pendingData = '';
      this.pendingReplayClaimToken = '';
      this.pendingReplayOutputRevision = 0;
      listener(data, replayClaimToken, this.generation, outputRevision);
    }
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    if (this.pendingExit) {
      listener(this.pendingExit, this.exitClaimToken);
      this.exitDelivered = true;
    }
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data) {
    const bytes = Buffer.from(String(data), 'utf8');
    for (let offset = 0; offset < bytes.length;) {
      let end = Math.min(bytes.length, offset + MAX_PTY_WRITE_BYTES);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
      this.client.command({
        action: 'write', id: this.id, generation: this.generation,
        data: bytes.subarray(offset, end).toString('base64')
      });
      offset = end;
    }
  }

  resize(cols, rows) {
    this.client.command({ action: 'resize', id: this.id, generation: this.generation, cols, rows });
  }

  async kill() {
    if (this.killPromise) return this.killPromise;
    this.killPromise = this.client.request('kill', { id: this.id, generation: this.generation })
      .then((result) => {
        this.detach();
        return result;
      })
      .catch((error) => {
        this.killPromise = null;
        throw error;
      });
    return this.killPromise;
  }

  pause() {
    this.client.command({ action: 'pause', id: this.id, generation: this.generation });
  }

  resume() {
    this.client.command({ action: 'resume', id: this.id, generation: this.generation });
  }

  detach() {
    if (this.client.handles.get(this.id) === this) this.client.handles.delete(this.id);
    this.dataListeners.clear();
    this.exitListeners.clear();
    this.pendingData = '';
    this.pendingReplayClaimToken = '';
    this.pendingReplayOutputRevision = 0;
    this.pendingExit = null;
    this.replayClaimToken = '';
    this.exitClaimToken = '';
  }

  acknowledgeExitedSession(claimToken) {
    if (!claimToken || claimToken !== this.exitClaimToken) return;
    this.exitClaimToken = '';
    this.client.command({
      action: 'ack-exited', id: this.id, generation: this.generation, claimToken
    });
  }

  acknowledgeReplay(claimToken) {
    if (!claimToken || claimToken !== this.replayClaimToken) return;
    this.replayClaimToken = '';
    this.client.command({
      action: 'ack-replay', id: this.id, generation: this.generation, claimToken
    });
  }

  checkpoint(outputRevision) {
    if (!Number.isSafeInteger(outputRevision) || outputRevision < 0) return;
    if (this.replayOutputRevision <= outputRevision) {
      this.replayClaimToken = '';
      this.replayOutputRevision = 0;
    }
    this.client.command({
      action: 'checkpoint', id: this.id, generation: this.generation, outputRevision
    });
  }

  emitData(data, replayClaimToken = '', outputRevision = 0) {
    if (this.dataListeners.size === 0) {
      this.pendingData = `${this.pendingData}${data}`;
      if (replayClaimToken) this.pendingReplayClaimToken = replayClaimToken;
      if (outputRevision) this.pendingReplayOutputRevision = outputRevision;
      return;
    }
    for (const listener of this.dataListeners) {
      listener(data, replayClaimToken, this.generation, outputRevision);
    }
  }

  emitExit(event) {
    this.pendingExit = event;
    for (const listener of this.exitListeners) listener(event, this.exitClaimToken);
    if (this.exitListeners.size > 0) {
      this.exitDelivered = true;
    }
    if (this.client.handles.get(this.id) === this) this.client.handles.delete(this.id);
  }
}

class WindowsPtyHostClient {
  constructor(socket, remainder = '') {
    this.socket = socket;
    this.buffered = remainder;
    this.handles = new Map();
    this.orphanData = new Map();
    this.orphanExits = new Map();
    this.pendingRequests = new Map();
    this.closeListeners = new Set();
    this.closed = false;
    this.closedIntentionally = false;
    socket.on('data', (chunk) => this.consume(chunk));
    socket.on('close', () => this.handleClose());
    socket.on('error', () => {});
    if (this.buffered) this.consume('');
  }

  consume(chunk) {
    this.buffered += chunk;
    let newline = this.buffered.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      if (line) {
        try {
          this.handleMessage(JSON.parse(line));
        } catch {
          this.socket.destroy();
          return;
        }
      }
      newline = this.buffered.indexOf('\n');
    }
  }

  handleMessage(message) {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(String(message.requestId || ''));
      if (!pending) return;
      this.pendingRequests.delete(message.requestId);
      if (message.error) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === 'data' || message.type === 'replay') {
      const id = String(message.id || '');
      const generation = String(message.generation || '');
      const key = sessionKey(id, generation);
      const data = Buffer.from(String(message.data || ''), 'base64').toString('utf8');
      const handle = this.handles.get(id);
      if (handle && (!generation || handle.generation === generation)) {
        if (message.type === 'replay') {
          handle.replayClaimToken = String(message.replayClaimToken || '');
          handle.replayOutputRevision = Number.isSafeInteger(message.outputRevision)
            ? message.outputRevision
            : 0;
        }
        handle.emitData(
          data,
          message.type === 'replay' ? handle.replayClaimToken : '',
          message.type === 'replay' ? handle.replayOutputRevision : 0
        );
      } else {
        const orphan = this.orphanData.get(key) || {
          data: '', replayClaimToken: '', outputRevision: 0
        };
        orphan.data += data;
        if (message.type === 'replay') {
          orphan.replayClaimToken = String(message.replayClaimToken || '');
          orphan.outputRevision = Number.isSafeInteger(message.outputRevision)
            ? message.outputRevision
            : 0;
        }
        this.orphanData.set(key, orphan);
      }
      return;
    }
    if (message.type === 'exit') {
      const id = String(message.id || '');
      const generation = String(message.generation || '');
      const key = sessionKey(id, generation);
      const event = {
        exitCode: Number(message.exitCode),
        signal: Number(message.signal),
        exitClaimToken: String(message.exitClaimToken || ''),
        outputRevision: Number.isSafeInteger(message.outputRevision) ? message.outputRevision : 0
      };
      const handle = this.handles.get(id);
      const replay = Buffer.from(String(message.replay || ''), 'base64').toString('utf8');
      if (handle && (!generation || handle.generation === generation)) {
        handle.exitClaimToken = event.exitClaimToken;
        const exitEvent = {
          exitCode: event.exitCode,
          signal: event.signal,
          outputRevision: event.outputRevision
        };
        if (replay) exitEvent.replay = replay;
        handle.emitExit(exitEvent);
      } else {
        this.orphanExits.set(key, { ...event, replay });
      }
    }
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error('The Windows PTY host connection closed.');
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
    for (const handle of this.handles.values()) handle.detach();
    this.handles.clear();
    this.orphanData.clear();
    this.orphanExits.clear();
    for (const listener of this.closeListeners) {
      try {
        listener();
      } catch {
        // A cache invalidation callback must not disrupt socket cleanup.
      }
    }
    this.closeListeners.clear();
  }

  onClose(listener) {
    if (this.closed) {
      listener();
      return { dispose() {} };
    }
    this.closeListeners.add(listener);
    return { dispose: () => this.closeListeners.delete(listener) };
  }

  request(action, payload = {}) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      try {
        send(this.socket, { type: 'request', requestId, action, ...payload });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  command(payload) {
    try {
      send(this.socket, { type: 'command', ...payload });
    } catch {
      // A disconnected main process will reattach on its next launch.
    }
  }

  async createSession(options) {
    const details = await this.request('create', { session: options });
    const handle = new WindowsPtyHandle(this, details);
    this.handles.set(details.id, handle);
    const key = sessionKey(details.id, details.generation);
    const replay = details.replay
      ? Buffer.from(String(details.replay), 'base64').toString('utf8')
      : '';
    const orphan = this.orphanData.get(key);
    const pending = details.exited
      ? replay
      : `${replay}${orphan?.data || ''}`;
    if (!details.exited && orphan?.replayClaimToken) {
      handle.replayClaimToken = orphan.replayClaimToken;
      handle.replayOutputRevision = orphan.outputRevision;
    }
    this.orphanData.delete(key);
    if (pending) {
      handle.emitData(pending, handle.replayClaimToken, handle.replayOutputRevision);
    } else if (handle.replayClaimToken) {
      handle.emitData('', handle.replayClaimToken, handle.replayOutputRevision);
    }
    const orphanExit = this.orphanExits.get(key);
    const pendingExit = details.exited ? {
      exitCode: Number(details.exitCode),
      signal: Number(details.signal),
      exitClaimToken: String(details.exitClaimToken || ''),
      outputRevision: Number.isSafeInteger(details.outputRevision) ? details.outputRevision : 0
    } : orphanExit;
    if (pendingExit) {
      this.orphanExits.delete(key);
      handle.exitClaimToken = pendingExit.exitClaimToken;
      const exitEvent = {
        exitCode: pendingExit.exitCode,
        signal: pendingExit.signal,
        outputRevision: pendingExit.outputRevision
      };
      if (!details.exited && pendingExit.replay) exitEvent.replay = pendingExit.replay;
      handle.emitExit(exitEvent);
    }
    return handle;
  }

  shutdownIfIdle() {
    return this.request('shutdown-if-idle');
  }

  disconnect() {
    this.closedIntentionally = true;
    for (const handle of this.handles.values()) handle.detach();
    this.handles.clear();
    this.orphanData.clear();
    this.orphanExits.clear();
    this.socket.end();
    this.socket.destroy();
  }
}

async function launchHost({ metadataPath, hostScript, executablePath, staleMetadata = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  const pipeName = `\\\\.\\pipe\\sideterm-pty-${crypto.randomUUID()}`;
  const currentMetadata = readMetadata(metadataPath);
  if (currentMetadata && !sameMetadata(currentMetadata, staleMetadata)) {
    const error = new Error('The Windows PTY host metadata changed while reconnecting.');
    error.code = 'SIDETERM_PTY_METADATA_CHANGED';
    throw error;
  }
  try {
    fs.unlinkSync(metadataPath);
  } catch {
    // Missing stale metadata is expected.
  }
  const child = spawn(executablePath, [hostScript], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SIDETERM_PTY_HOST_METADATA: metadataPath,
      SIDETERM_PTY_HOST_PIPE: pipeName,
      SIDETERM_PTY_HOST_TOKEN: token
    }
  });
  child.unref();
  return { protocol: 1, pipeName, token, pid: child.pid };
}

async function connectWindowsPtyHost({
  metadataPath, hostScript, executablePath = process.execPath, timeoutMs = 5_000,
  replayAcknowledgements = true
}) {
  const deadline = Date.now() + timeoutMs;
  const existing = readMetadata(metadataPath);
  if (existing) {
    let lastError = null;
    let sawFailure = false;
    let onlyMissingEndpointFailures = true;
    let missingEndpointFailures = 0;
    while (Date.now() < deadline) {
      try {
        const remaining = Math.max(50, Math.min(1_000, deadline - Date.now()));
        const connected = await connectSocket(existing, remaining, replayAcknowledgements);
        return new WindowsPtyHostClient(connected.socket, connected.remainder);
      } catch (error) {
        lastError = error;
        sawFailure = true;
        if (error?.code === 'ENOENT') missingEndpointFailures += 1;
        else onlyMissingEndpointFailures = false;
        if (!processIsRunning(existing.pid)) break;
        if (missingEndpointFailures >= 3 && onlyMissingEndpointFailures) break;
        await delay(50);
      }
    }
    if (processIsRunning(existing.pid) && !(sawFailure && onlyMissingEndpointFailures)) {
      throw lastError || new Error('Could not reconnect to the live Windows PTY host.');
    }
  }

  let launched;
  try {
    launched = await launchHost({ metadataPath, hostScript, executablePath, staleMetadata: existing });
  } catch (error) {
    if (error?.code !== 'SIDETERM_PTY_METADATA_CHANGED') throw error;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw error;
    return connectWindowsPtyHost({
      metadataPath, hostScript, executablePath, timeoutMs: remaining, replayAcknowledgements
    });
  }
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const metadata = readMetadata(metadataPath) || launched;
      const connected = await connectSocket(metadata, 250, replayAcknowledgements);
      return new WindowsPtyHostClient(connected.socket, connected.remainder);
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw lastError || new Error('Could not start the Windows PTY host.');
}

module.exports = {
  connectWindowsPtyHost,
  readMetadata,
  validMetadata,
  WindowsPtyHostClient,
  WindowsPtyHandle
};
