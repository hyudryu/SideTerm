const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GET_PIP_URL, ensureVoiceEnvironment } = require('../electron/voice/runtime.cjs');

function temporaryRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sideterm-voice-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('keeps an existing voice environment when pip works', async (t) => {
  const root = temporaryRuntime(t);
  const python = path.join(root, 'venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'fake');
  const calls = [];

  const result = await ensureVoiceEnvironment({
    runtimeDirectory: root,
    runChild: async (executable, args) => calls.push([executable, args]),
    downloadFile: async () => assert.fail('healthy environments must not download get-pip')
  });

  assert.equal(result, python);
  assert.deepEqual(calls, [[python, ['-m', 'pip', '--version']]]);
});

test('repairs a partial Ubuntu environment without requiring python3-venv', async (t) => {
  const root = temporaryRuntime(t);
  const python = path.join(root, 'venv', 'bin', 'python');
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
  assert.deepEqual(calls.at(-1), [python, ['-m', 'pip', '--version']]);
});
