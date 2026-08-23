const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GET_PIP_URL, ensureVoiceEnvironment, venvPythonPath } = require('../electron/voice/runtime.cjs');

function temporaryRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-voice-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('keeps an existing voice environment when pip works', async (t) => {
  const root = temporaryRuntime(t);
  const python = venvPythonPath(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'fake');
  const calls = [];

  const result = await ensureVoiceEnvironment({
    runtimeDirectory: root,
    runChild: async (executable, args) => calls.push([executable, args]),
    downloadFile: async () => assert.fail('healthy environments must not download get-pip'),
    preferredVersions: []
  });

  assert.equal(result, python);
  assert.deepEqual(calls, [[python, ['-m', 'pip', '--version']]]);
});

test('repairs a partial Ubuntu environment without requiring python3-venv', async (t) => {
  const root = temporaryRuntime(t);
  const python = venvPythonPath(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'partial');
  const calls = [];
  let pipReady = false;
  let downloaded = false;

  const runChild = async (executable, args) => {
    calls.push([executable, args]);
    if (args[0] === '-m' && args[1] === 'pip' && !pipReady) throw new Error('No module named pip');
    if (args[0] === '-m' && args[1] === 'ensurepip') throw new Error('ensurepip unavailable');
    if (args[0]?.endsWith('get-pip.py')) pipReady = true;
    return { stdout: '' };
  };

  const result = await ensureVoiceEnvironment({
    runtimeDirectory: root,
    runChild,
    downloadFile: async (url, destination) => {
      downloaded = true;
      assert.equal(url, GET_PIP_URL);
      assert.equal(destination, path.join(root, 'get-pip.py'));
    }
  });

  assert.equal(result, python);
  assert.equal(downloaded, true);
  assert.ok(calls.some(([, args]) => args.includes('--without-pip') && args.includes('--clear')));
  assert.ok(calls.some(([, args]) => args[0] === '-m' && args[1] === 'ensurepip'));
  assert.ok(calls.some(([, args]) => args[0] === path.join(root, 'get-pip.py')));
  assert.ok(calls.some(([executable, args]) => executable === python && args.join(' ') === '-m pip --version'));
});

test('reuses an environment whose interpreter matches the preferred versions', async (t) => {
  const root = temporaryRuntime(t);
  const python = venvPythonPath(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'fake');
  fs.writeFileSync(path.join(root, 'venv-python.txt'), '3.12\n');
  const calls = [];

  const result = await ensureVoiceEnvironment({
    runtimeDirectory: root,
    runChild: async (executable, args) => calls.push([executable, args]),
    downloadFile: async () => assert.fail('compatible environments must be reused'),
    preferredVersions: ['3.12', '3.11']
  });

  assert.equal(result, python);
  assert.deepEqual(calls, [[python, ['-m', 'pip', '--version']]]);
});

test('rebuilds an environment created with an incompatible interpreter', async (t) => {
  const root = temporaryRuntime(t);
  const python = venvPythonPath(path.join(root, 'venv'));
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'fake');
  fs.writeFileSync(path.join(root, 'venv-python.txt'), '3.14\n');
  const calls = [];
  let recreated = false;

  const result = await ensureVoiceEnvironment({
    runtimeDirectory: root,
    runChild: async (executable, args) => {
      calls.push([executable, args]);
      if (args.includes('-c')) return { stdout: '3.12\n' };
      return { stdout: '' };
    },
    downloadFile: async () => assert.fail('ensurepip should succeed'),
    systemPython: 'C:\\Python312\\python.exe',
    preferredVersions: ['3.12'],
    onEnvironmentRecreated: async () => { recreated = true; }
  });

  assert.equal(result, python);
  assert.equal(recreated, true);
  assert.ok(calls.some(([executable, args]) => executable === 'C:\\Python312\\python.exe'
    && args.includes('--without-pip') && args.includes('--clear')));
  assert.equal(fs.readFileSync(path.join(root, 'venv-python.txt'), 'utf8').trim(), '3.12');
});
