const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

function send(socket, payload) {
  if (socket.destroyed) throw new Error('The Windows PTY host connection is closed.');
  socket.write(`${JSON.stringify(payload)}\n`);
}

function connectSocket(metadata, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(metadata.pipeName);
    socket.setEncoding('utf8');
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out connecting to the Windows PTY host.'));
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
    socket.once('connect', () => send(socket, { type: 'auth', token: metadata.token }));
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
    this.exitClaimToken = String(details.exitClaimToken || '');
    this.exitDelivered = false;
    this.dataListeners = new Set();
    this.exitListeners = new Set();
    this.pendingData = '';
    this.pendingExit = null;
  }

  onData(listener) {
    this.dataListeners.add(listener);
    if (this.pendingData) {
      const data = this.pendingData;
      this.pendingData = '';
      listener(data);
      this.acknowledgeExitedSession();
    }
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    if (this.pendingExit) {
      listener(this.pendingExit);
      this.exitDelivered = true;
      this.acknowledgeExitedSession();
    }
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data) {
    this.client.command({ action: 'write', id: this.id, data: Buffer.from(String(data), 'utf8').toString('base64') });
  }

  resize(cols, rows) {
    this.client.command({ action: 'resize', id: this.id, cols, rows });
  }

  kill() {
    this.client.command({ action: 'kill', id: this.id });
  }

  pause() {
    this.client.command({ action: 'pause', id: this.id });
  }

  resume() {
    this.client.command({ action: 'resume', id: this.id });
  }

  detach() {
    this.client.handles.delete(this.id);
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  acknowledgeExitedSession() {
    if (!this.exitClaimToken || !this.exitDelivered || this.pendingData) return;
    const claimToken = this.exitClaimToken;
    this.exitClaimToken = '';
    this.client.command({ action: 'ack-exited', id: this.id, claimToken });
  }

  emitData(data) {
    if (this.dataListeners.size === 0) {
      this.pendingData = `${this.pendingData}${data}`.slice(-300_000);
      return;
    }
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(event) {
    this.pendingExit = event;
    for (const listener of this.exitListeners) listener(event);
    if (this.exitListeners.size > 0) {
      this.exitDelivered = true;
      this.acknowledgeExitedSession();
    }
    this.client.handles.delete(this.id);
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
    if (message.type === 'data') {
      const id = String(message.id || '');
      const data = Buffer.from(String(message.data || ''), 'base64').toString('utf8');
      const handle = this.handles.get(id);
      if (handle) handle.emitData(data);
      else this.orphanData.set(id, `${this.orphanData.get(id) || ''}${data}`.slice(-300_000));
      return;
    }
    if (message.type === 'exit') {
      const id = String(message.id || '');
      const event = {
        exitCode: Number(message.exitCode),
        signal: Number(message.signal)
      };
      const handle = this.handles.get(id);
      if (handle) handle.emitExit(event);
      else this.orphanExits.set(id, event);
    }
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error('The Windows PTY host connection closed.');
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
    if (!this.closedIntentionally) {
      for (const handle of this.handles.values()) handle.emitExit({ exitCode: -1, signal: 0 });
    }
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
    const replay = details.replay
      ? Buffer.from(String(details.replay), 'base64').toString('utf8')
      : '';
    const pending = `${replay}${this.orphanData.get(details.id) || ''}`;
    if (pending) {
      this.orphanData.delete(details.id);
      handle.emitData(pending);
    }
    const pendingExit = this.orphanExits.get(details.id) || (details.exited ? {
      exitCode: Number(details.exitCode),
      signal: Number(details.signal)
    } : null);
    if (pendingExit) {
      this.orphanExits.delete(details.id);
      handle.emitExit(pendingExit);
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

async function connectWindowsPtyHost({ metadataPath, hostScript, executablePath = process.execPath, timeoutMs = 5_000 }) {
  const deadline = Date.now() + timeoutMs;
  const existing = readMetadata(metadataPath);
  if (existing) {
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const remaining = Math.max(50, Math.min(1_000, deadline - Date.now()));
        const connected = await connectSocket(existing, remaining);
        return new WindowsPtyHostClient(connected.socket, connected.remainder);
      } catch (error) {
        lastError = error;
        if (!processIsRunning(existing.pid)) break;
        await delay(50);
      }
    }
    if (processIsRunning(existing.pid)) {
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
    return connectWindowsPtyHost({ metadataPath, hostScript, executablePath, timeoutMs: remaining });
  }
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const metadata = readMetadata(metadataPath) || launched;
      const connected = await connectSocket(metadata, 250);
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
