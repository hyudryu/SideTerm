import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { resolveTerminalShortcut } from './keyboard.js';

const api = window.sideTerm;
const sessions = new Map();
let activeId = null;
let sequence = 0;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

document.querySelector('#app').innerHTML = `
  <main class="app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}">
    <aside class="sidebar" aria-label="Terminal sessions">
      <header class="brand-row">
        <div class="brand-mark" aria-hidden="true">›_</div>
        <div class="brand-copy">
          <strong>SideTerm</strong>
          <span>Ubuntu terminal</span>
        </div>
        <button id="collapse-button" class="icon-button collapse-button" type="button" title="Collapse sidebar (Ctrl+Shift+B)" aria-label="Collapse sidebar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
        </button>
      </header>
      <div class="sidebar-label">SESSIONS</div>
      <nav id="session-list" class="session-list"></nav>
      <button id="new-session" class="new-session" type="button" title="New session (Ctrl+Shift+T)">
        <span class="plus">+</span><span class="new-session-label">New session</span>
      </button>
      <footer class="shortcut-hint">
        <span><kbd>Ctrl</kbd>+<kbd>C</kbd> Copy</span>
        <span><kbd>Ctrl</kbd>+<kbd>V</kbd> Paste</span>
      </footer>
    </aside>
    <section class="workspace">
      <header class="command-bar">
        <div class="active-session-heading">
          <span class="status-dot"></span>
          <div>
            <strong id="active-title">Terminal</strong>
            <span id="active-subtitle">Starting shell…</span>
          </div>
        </div>
        <div class="command-actions">
          <button id="copy-button" class="toolbar-button" type="button" title="Copy selected text (Ctrl+C)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
            <span>Copy</span>
          </button>
          <button id="paste-button" class="toolbar-button" type="button" title="Paste (Ctrl+V)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6"/><path d="M9 4a2 2 0 0 0-2 2v1h10V6a2 2 0 0 0-2-2"/><rect x="5" y="6" width="14" height="15" rx="2"/></svg>
            <span>Paste</span>
          </button>
          <button id="more-button" class="toolbar-button icon-only" type="button" title="Open current folder" aria-label="Open current folder">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7v11"/></svg>
          </button>
        </div>
      </header>
      <div id="terminal-stack" class="terminal-stack"></div>
      <div id="toast-region" class="toast-region" aria-live="polite"></div>
    </section>
  </main>
`;

const shellElement = document.querySelector('.app-shell');
const sessionList = document.querySelector('#session-list');
const terminalStack = document.querySelector('#terminal-stack');
const activeTitle = document.querySelector('#active-title');
const activeSubtitle = document.querySelector('#active-subtitle');
const collapseButton = document.querySelector('#collapse-button');
const newSessionButton = document.querySelector('#new-session');
const toastRegion = document.querySelector('#toast-region');

function makeId() {
  sequence += 1;
  return `session-${Date.now()}-${sequence}`;
}

function sessionNumber() {
  return sessions.size + 1;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.classList.add('visible'), 10);
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 180);
  }, 1800);
}

function updateSidebarState() {
  shellElement.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  collapseButton.title = sidebarCollapsed
    ? 'Expand sidebar (Ctrl+Shift+B)'
    : 'Collapse sidebar (Ctrl+Shift+B)';
  collapseButton.setAttribute('aria-label', sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  window.setTimeout(fitActive, 220);
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  updateSidebarState();
}

function renderSessionItem(session) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'session-item';
  item.dataset.sessionId = session.id;
  item.title = session.title;
  item.innerHTML = `
    <span class="session-icon">›_</span>
    <span class="session-details">
      <strong></strong>
      <small></small>
    </span>
    <span class="session-close" role="button" aria-label="Close session" title="Close session">×</span>
  `;
  item.querySelector('strong').textContent = session.title;
  item.querySelector('small').textContent = session.shell;
  item.addEventListener('click', (event) => {
    if (event.target.closest('.session-close')) {
      event.stopPropagation();
      closeSession(session.id);
      return;
    }
    activateSession(session.id);
  });
  session.item = item;
  sessionList.append(item);
}

function updateSessionLabel(session) {
  session.item.title = session.title;
  session.item.querySelector('strong').textContent = session.title;
  if (session.id === activeId) activeTitle.textContent = session.title;
}

function activateSession(id) {
  const next = sessions.get(id);
  if (!next) return;
  activeId = id;
  for (const session of sessions.values()) {
    const isActive = session.id === id;
    session.pane.classList.toggle('active', isActive);
    session.item.classList.toggle('active', isActive);
    session.item.setAttribute('aria-current', isActive ? 'page' : 'false');
  }
  activeTitle.textContent = next.title;
  activeSubtitle.textContent = `${next.shell} · ${next.cwd}`;
  requestAnimationFrame(() => {
    fitSession(next);
    next.terminal.focus();
  });
}

function fitSession(session) {
  if (!session || !session.pane.classList.contains('active')) return;
  try {
    session.fit.fit();
    api.resize(session.id, session.terminal.cols, session.terminal.rows);
  } catch {
    // A hidden or closing terminal can briefly have no measurable size.
  }
}

function fitActive() {
  fitSession(sessions.get(activeId));
}

async function copySelection() {
  const session = sessions.get(activeId);
  if (!session?.terminal.hasSelection()) {
    showToast('Select terminal text to copy');
    return;
  }
  await api.writeClipboard(session.terminal.getSelection());
  session.terminal.clearSelection();
  showToast('Copied');
}

async function pasteClipboard() {
  const session = sessions.get(activeId);
  if (!session) return;
  const text = await api.readClipboard();
  if (text) session.terminal.paste(text);
  session.terminal.focus();
}

function cycleSession(direction) {
  const ids = [...sessions.keys()];
  if (ids.length < 2) return;
  const index = ids.indexOf(activeId);
  activateSession(ids[(index + direction + ids.length) % ids.length]);
}

async function addSession(cwd) {
  const id = makeId();
  const number = sessionNumber();
  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  pane.dataset.sessionId = id;
  terminalStack.append(pane);

  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontFamily: "'Cascadia Code', 'CaskaydiaCove Nerd Font', 'Ubuntu Mono', monospace",
    fontSize: 15,
    fontWeight: '400',
    fontWeightBold: '600',
    letterSpacing: 0.1,
    lineHeight: 1.15,
    scrollback: 10000,
    theme: {
      background: '#0c0c0c',
      foreground: '#f2f2f2',
      cursor: '#f2f2f2',
      cursorAccent: '#0c0c0c',
      selectionBackground: '#264f78',
      black: '#0c0c0c',
      red: '#c50f1f',
      green: '#13a10e',
      yellow: '#c19c00',
      blue: '#0037da',
      magenta: '#881798',
      cyan: '#3a96dd',
      white: '#cccccc',
      brightBlack: '#767676',
      brightRed: '#e74856',
      brightGreen: '#16c60c',
      brightYellow: '#f9f1a5',
      brightBlue: '#3b78ff',
      brightMagenta: '#b4009e',
      brightCyan: '#61d6d6',
      brightWhite: '#f2f2f2'
    }
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(pane);

  const session = {
    id,
    title: `Terminal ${number}`,
    shell: 'shell',
    cwd: cwd || '~',
    terminal,
    fit,
    pane,
    item: null
  };
  sessions.set(id, session);
  renderSessionItem(session);
  activateSession(id);

  terminal.onData((data) => api.write(id, data));
  terminal.onResize(({ cols, rows }) => api.resize(id, cols, rows));
  terminal.onTitleChange((title) => {
    const cleaned = title.trim();
    if (!cleaned) return;
    session.title = cleaned.length > 34 ? `${cleaned.slice(0, 31)}…` : cleaned;
    updateSessionLabel(session);
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const action = resolveTerminalShortcut(event, terminal.hasSelection());
    if (!action) return true;
    if (action === 'terminal-input') return true;
    if (action === 'copy') void copySelection();
    if (action === 'paste') void pasteClipboard();
    if (action === 'new-session') void addSession(session.cwd);
    if (action === 'close-session') closeSession(activeId);
    if (action === 'toggle-sidebar') toggleSidebar();
    if (action === 'next-session') cycleSession(1);
    if (action === 'previous-session') cycleSession(-1);
    return false;
  });
  pane.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (terminal.hasSelection()) void copySelection();
    else void pasteClipboard();
  });

  try {
    fit.fit();
    const details = await api.createSession({ id, cwd, cols: terminal.cols, rows: terminal.rows });
    session.shell = details.shell;
    session.cwd = details.cwd;
    session.item.querySelector('small').textContent = details.shell;
    activeSubtitle.textContent = `${details.shell} · ${details.cwd}`;
    terminal.focus();
  } catch (error) {
    terminal.writeln(`\r\n\x1b[31mCould not start the shell: ${error.message}\x1b[0m`);
  }
}

function closeSession(id, exited = false) {
  const session = sessions.get(id);
  if (!session) return;
  const ids = [...sessions.keys()];
  const index = ids.indexOf(id);
  if (!exited) api.close(id);
  session.terminal.dispose();
  session.pane.remove();
  session.item.remove();
  sessions.delete(id);

  if (sessions.size === 0) {
    activeId = null;
    void addSession();
    return;
  }
  if (activeId === id) {
    const remaining = [...sessions.keys()];
    activateSession(remaining[Math.min(index, remaining.length - 1)]);
  }
}

api.onData(({ id, data }) => sessions.get(id)?.terminal.write(data));
api.onExit(({ id, exitCode }) => {
  if (!sessions.has(id)) return;
  showToast(`Session exited (${exitCode})`);
  closeSession(id, true);
});

new ResizeObserver(fitActive).observe(terminalStack);
window.addEventListener('resize', fitActive);
collapseButton.addEventListener('click', toggleSidebar);
newSessionButton.addEventListener('click', () => void addSession(sessions.get(activeId)?.cwd));
document.querySelector('#copy-button').addEventListener('click', () => void copySelection());
document.querySelector('#paste-button').addEventListener('click', () => void pasteClipboard());
document.querySelector('#more-button').addEventListener('click', () => {
  const session = sessions.get(activeId);
  if (session) void api.openPath(session.cwd);
});

window.addEventListener('keydown', (event) => {
  // xterm's focused textarea is handled above; do not fire clipboard actions twice
  // when that same keydown bubbles to the window.
  if (event.target instanceof Element && event.target.closest('.xterm')) return;
  const action = resolveTerminalShortcut(event, sessions.get(activeId)?.terminal.hasSelection() ?? false);
  if (!action || action === 'terminal-input') return;
  event.preventDefault();
  if (action === 'copy') void copySelection();
  if (action === 'paste') void pasteClipboard();
  if (action === 'new-session') void addSession(sessions.get(activeId)?.cwd);
  if (action === 'close-session') closeSession(activeId);
  if (action === 'toggle-sidebar') toggleSidebar();
  if (action === 'next-session') cycleSession(1);
  if (action === 'previous-session') cycleSession(-1);
});

updateSidebarState();
void addSession();
