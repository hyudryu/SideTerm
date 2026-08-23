const fs = require('node:fs');
const path = require('node:path');

const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const WINDOWS = process.platform === 'win32';

// Speech dependencies (NeMo, pinned NumPy) only ship wheels for these CPython
// versions on Windows; a venv built with anything else fails to install.
const WINDOWS_PREFERRED_PYTHON_VERSIONS = ['3.12', '3.11', '3.10'];

function venvPythonPath(venvDirectory) {
  return WINDOWS
    ? path.join(venvDirectory, 'Scripts', 'python.exe')
    : path.join(venvDirectory, 'bin', 'python');
}

async function pythonMajorMinor(executable, prefixArgs, runChild) {
  try {
    const { stdout } = await runChild(executable, [
      ...prefixArgs,
      '-c',
      'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'
    ], { timeoutMs: 30_000 });
    return String(stdout || '').trim().split('\n').pop().trim();
  } catch {
    return '';
  }
}

async function resolveSystemPython(runChild, preferredVersions = WINDOWS_PREFERRED_PYTHON_VERSIONS) {
  if (!WINDOWS) return { executable: '/usr/bin/python3', prefixArgs: [] };
  const override = process.env.SIDETERM_VOICE_PYTHON;
  if (override && fs.existsSync(override)) return { executable: override, prefixArgs: [] };
  for (const version of preferredVersions) {
    if (await pythonMajorMinor('py', [`-${version}`], runChild) === version) {
      return { executable: 'py', prefixArgs: [`-${version}`] };
    }
  }
  return { executable: 'python', prefixArgs: [] };
}

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
  systemPython,
  systemPythonArgs = [],
  preferredVersions = WINDOWS ? WINDOWS_PREFERRED_PYTHON_VERSIONS : [],
  onEnvironmentRecreated
}) {
  if (typeof runChild !== 'function' || typeof downloadFile !== 'function') {
    throw new TypeError('Voice runtime setup requires process and download helpers.');
  }

  const venvDirectory = path.join(runtimeDirectory, 'venv');
  const python = venvPythonPath(venvDirectory);
  const stampPath = path.join(runtimeDirectory, 'venv-python.txt');
  fs.mkdirSync(runtimeDirectory, { recursive: true });

  if (await hasWorkingPip(python, runChild)) {
    if (preferredVersions.length === 0) return python;
    const stamped = fs.existsSync(stampPath)
      ? fs.readFileSync(stampPath, 'utf8').trim()
      : await pythonMajorMinor(python, [], runChild);
    if (!stamped || preferredVersions.includes(stamped)) return python;
    // The existing environment uses an interpreter without wheel coverage for
    // the speech dependencies (e.g. a too-new Python); rebuild it below.
  }

  const resolved = systemPython
    ? { executable: systemPython, prefixArgs: systemPythonArgs }
    : await resolveSystemPython(runChild, preferredVersions);
  const hadEnvironment = fs.existsSync(python);

  // --without-pip works on Debian/Ubuntu even when the optional python3-venv
  // package (which supplies ensurepip) is not installed. --clear also repairs
  // partial environments left behind by an interrupted or failed setup.
  await runChild(resolved.executable, [...resolved.prefixArgs, '-m', 'venv', '--without-pip', '--clear', venvDirectory]);

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
  const createdVersion = await pythonMajorMinor(python, [], runChild);
  if (createdVersion) fs.writeFileSync(stampPath, `${createdVersion}\n`, { mode: 0o600 });
  if (hadEnvironment && typeof onEnvironmentRecreated === 'function') await onEnvironmentRecreated();
  return python;
}

module.exports = {
  GET_PIP_URL,
  WINDOWS_PREFERRED_PYTHON_VERSIONS,
  ensureVoiceEnvironment,
  hasWorkingPip,
  pythonMajorMinor,
  resolveSystemPython,
  venvPythonPath
};
