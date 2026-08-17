const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const pty = require('node-pty');

const isDev = !app.isPackaged;
const sessions = new Map();
let mainWindow;

function resolveShell() {
  const configured = process.env.SHELL;
  if (configured && fs.existsSync(configured)) return configured;
  return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

function safeCwd(requested) {
  if (requested) {
    try {
      if (fs.statSync(requested).isDirectory()) return requested;
    } catch {
      // Fall back to the user's home directory.
    }
  }
  return os.homedir();
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createSession({ id, cwd, cols = 100, rows = 30 }) {
  if (!id || sessions.has(id)) {
    throw new Error('A unique session id is required.');
  }

  const shellPath = resolveShell();
  const workingDirectory = safeCwd(cwd);
  const processHandle = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    cwd: workingDirectory,
    env: {
      ...process.env,
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'SideTerm'
    }
  });

  sessions.set(id, processHandle);
  processHandle.onData((data) => send('terminal:data', { id, data }));
  processHandle.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    send('terminal:exit', { id, exitCode, signal });
  });

  return {
    id,
    pid: processHandle.pid,
    cwd: workingDirectory,
    shell: path.basename(shellPath)
  };
}

function closeSession(id) {
  const processHandle = sessions.get(id);
  if (!processHandle) return;
  sessions.delete(id);
  try {
    processHandle.kill();
  } catch {
    // The process may already have exited.
  }
}

function closeAllSessions() {
  for (const id of [...sessions.keys()]) closeSession(id);
}

function registerIpc() {
  ipcMain.handle('terminal:create', (_event, options) => createSession(options));
  ipcMain.on('terminal:write', (_event, { id, data }) => {
    sessions.get(id)?.write(data);
  });
  ipcMain.on('terminal:resize', (_event, { id, cols, rows }) => {
    const processHandle = sessions.get(id);
    if (!processHandle || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
    try {
      processHandle.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    } catch {
      // Ignore resize races while a process is exiting.
    }
  });
  ipcMain.on('terminal:close', (_event, id) => closeSession(id));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(String(text)));
  ipcMain.handle('shell:open-path', async (_event, targetPath) => {
    const directory = safeCwd(targetPath);
    return shell.openPath(directory);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 680,
    minHeight: 420,
    backgroundColor: '#0c0c0c',
    title: 'SideTerm',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && url.startsWith('http://127.0.0.1:5173');
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.SIDETERM_DEV_URL || 'http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    closeAllSessions();
    mainWindow = null;
  });
}

app.setName('SideTerm');
app.setAppUserModelId('io.github.hyudryu.sideterm');

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeAllSessions();
  if (process.platform !== 'darwin') app.quit();
});
