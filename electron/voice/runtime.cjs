const fs = require('node:fs');
const path = require('node:path');

const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

async function hasWorkingPip(python, runChild) {
  if (!fs.existsSync(python)) return false;
  try {
    await runChild(python, ['-m', 'pip', '--version'], { timeoutMs: 60_000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureVoiceEnvironment({
  runtimeDirectory,
  runChild,
  downloadFile,
  systemPython = '/usr/bin/python3'
}) {
  if (typeof runChild !== 'function' || typeof downloadFile !== 'function') {
    throw new TypeError('Voice runtime setup requires process and download helpers.');
  }

  const venvDirectory = path.join(runtimeDirectory, 'venv');
  const python = path.join(venvDirectory, 'bin', 'python');
  fs.mkdirSync(runtimeDirectory, { recursive: true });

  if (await hasWorkingPip(python, runChild)) return python;

  // --without-pip works on Debian/Ubuntu even when the optional python3-venv
  // package (which supplies ensurepip) is not installed. --clear also repairs
  // partial environments left behind by an interrupted or failed setup.
  await runChild(systemPython, ['-m', 'venv', '--without-pip', '--clear', venvDirectory]);

  try {
    await runChild(python, ['-m', 'ensurepip', '--upgrade'], { timeoutMs: 5 * 60_000 });
  } catch {
    const bootstrap = path.join(runtimeDirectory, 'get-pip.py');
    await downloadFile(GET_PIP_URL, bootstrap);
    await runChild(python, [bootstrap, '--disable-pip-version-check'], { timeoutMs: 10 * 60_000 });
  }

  if (!await hasWorkingPip(python, runChild)) {
    throw new Error('SideTerm created the speech environment, but could not initialize pip. Check your network connection and try again.');
  }
  return python;
}

module.exports = { GET_PIP_URL, ensureVoiceEnvironment, hasWorkingPip };
