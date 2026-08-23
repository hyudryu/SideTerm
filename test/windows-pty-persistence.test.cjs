const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  connectWindowsPtyHost,
  validMetadata
} = require('../electron/sessions/windows-pty-client.cjs');

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

test('detached PTY host preserves a live session across client restarts', { timeout: 20_000 }, async (t) => {
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
    "process.stdin.on('data', (data) => process.stdout.write('HOST_ECHO:' + data))",
    'setInterval(() => {}, 1000)'
  ].join(';');
  const options = {
    id: 'persistent-session',
    executable: process.execPath,
    args: ['-e', childScript],
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: temporaryDirectory,
    env: { SIDETERM_TEST_ENV: '1' }
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
});
