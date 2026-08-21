const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

class PersistentSpeechWorker {
  constructor({ executable, args, env = process.env, spawnProcess = spawn, timeoutMs = 30 * 60_000 } = {}) {
    if (!executable || !Array.isArray(args)) throw new Error('Speech worker requires an executable and arguments.');
    this.executable = executable;
    this.args = args;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.stdout = '';
    this.stderr = '';
    this.pending = new Map();
  }

  start() {
    if (this.child) return this.child;
    const child = this.spawnProcess(this.executable, this.args, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-100_000);
    });
    child.once('error', (error) => this.fail(child, error));
    child.once('exit', (code, signal) => {
      const detail = this.stderr.trim().split('\n').slice(-8).join('\n');
      this.fail(child, new Error(detail || `Speech worker exited (${signal || code}).`));
    });
    return child;
  }

  handleStdout(chunk) {
    this.stdout += String(chunk);
    const lines = this.stdout.split('\n');
    this.stdout = lines.pop() || '';
    for (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(String(message?.requestId || ''));
      if (!pending) continue;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(String(message.error || 'The speech worker failed.')));
    }
  }

  request(command, payload = {}, { timeoutMs = this.timeoutMs } = {}) {
    const child = this.start();
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        reject(new Error('The local speech operation timed out.'));
        this.stop();
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ requestId, command, ...payload })}\n`, (error) => {
        if (!error || !this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  fail(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.stdout = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The speech worker stopped.'));
    }
    this.pending.clear();
    child.kill('SIGTERM');
  }
}

module.exports = { PersistentSpeechWorker };
