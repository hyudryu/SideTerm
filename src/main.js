import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import {
  DEFAULT_HOTKEYS,
  consumeTerminalShortcutEvent,
  keyboardEventToAccelerator,
  resolveTerminalShortcut
} from './keyboard.js';
import {
  WORKSPACE_VERSION,
  createGroup,
  moveSession,
  parseSavedWorkspace,
  removeSessionFromGroups,
  reorderGroup
} from './workspace.js';

const api = window.sideTerm;
const WORKSPACE_KEY = 'sidetermWorkspace';
const MAX_HISTORY_LINES = 400;
const MAX_HISTORY_CHARS = 120_000;
const BACKGROUND_SETTLE_MS = 4_000;
const AI_SUMMARY_SETTLE_MS = 6_000;
const MAX_CONTEXT_CHARS = 16_000;
const sessions = new Map();
const restoredWorkspace = parseSavedWorkspace(localStorage.getItem(WORKSPACE_KEY));
const defaultGroup = createGroup(`group-${crypto.randomUUID()}`, 'General');
let groups = restoredWorkspace?.groups ?? [defaultGroup];
let activeGroupId = restoredWorkspace?.activeGroupId ?? groups[0].id;
let activeId = null;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
let restoringWorkspace = true;
let persistTimer = null;
let persistInFlight = false;
let dragState = null;
let dropTarget = null;
let clearApiKeyRequested = false;
let settings = {
  llmEnabled: false,
  hasApiKey: false,
  model: 'gpt-5.6-luna',
  sidebarWidth: 282,
  hotkeys: { ...DEFAULT_HOTKEYS }
};
let linkPopoverTimer = null;

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
      <div class="sidebar-heading">
        <span>SESSION GROUPS</span>
        <button id="heading-new-group" class="heading-action" type="button" title="Create group" aria-label="Create group">+</button>
      </div>
      <nav id="session-list" class="session-list" aria-label="Session groups"></nav>
      <div class="sidebar-actions">
        <button id="new-session" class="new-session" type="button" title="New session in active group (Ctrl+Shift+T)">
          <span class="plus">+</span><span class="action-label">New session</span>
        </button>
        <button id="new-group" class="new-group" type="button" title="Create group">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/></svg>
          <span class="action-label">New group</span>
        </button>
      </div>
      <footer class="shortcut-hint">
        <span><kbd>Ctrl</kbd>+<kbd>C</kbd> Copy</span>
        <span><kbd>Ctrl</kbd>+<kbd>V</kbd> Paste</span>
      </footer>
      <button id="settings-button" class="settings-button" type="button" title="Settings (Ctrl+,)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.37.55.72 1 .9.35.15.73.2 1.1.1h.1v4h-.09a1.7 1.7 0 0 0-1.51.6c-.28.28-.48.62-.6 1Z"/></svg>
        <span class="action-label">Settings</span>
      </button>
      <div id="sidebar-resizer" class="sidebar-resizer" title="Drag to resize sidebar"></div>
    </aside>
    <section class="workspace">
      <header class="command-bar">
        <div class="active-session-heading">
          <span class="status-dot"></span>
          <div>
            <strong id="active-title">Terminal</strong>
            <span id="active-subtitle">Restoring workspace…</span>
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
          <button id="open-folder-button" class="toolbar-button icon-only" type="button" title="Open current folder" aria-label="Open current folder">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7v11"/></svg>
          </button>
        </div>
      </header>
      <div id="terminal-stack" class="terminal-stack"></div>
      <div id="toast-region" class="toast-region" aria-live="polite"></div>
    </section>
    <div id="settings-backdrop" class="settings-backdrop" hidden>
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-header">
          <div><strong id="settings-title">SideTerm settings</strong><span>Customize your coding workspace</span></div>
          <button id="settings-close" class="settings-close" type="button" aria-label="Close settings">×</button>
        </header>
        <form id="settings-form">
          <div class="settings-scroll">
            <section class="settings-section">
              <div class="settings-section-title"><strong>AI session context</strong><span>Optional · OpenAI Responses API</span></div>
              <label class="toggle-row">
                <span><strong>Automatic session naming</strong><small>Summarize recent terminal context after activity settles.</small></span>
                <input id="ai-enabled" type="checkbox"><i></i>
              </label>
              <label class="field-row"><span>API key</span><input id="api-key" type="password" autocomplete="off" placeholder="sk-…"></label>
              <div class="credential-actions"><span id="api-key-state">No key configured</span><button id="clear-api-key" type="button">Clear key</button></div>
              <label class="field-row"><span>Model</span><input id="ai-model" type="text" value="gpt-5.6-luna" spellcheck="false"></label>
              <p class="settings-note">When enabled, recent terminal text is sent to the configured OpenAI model to produce a short name and context. The API key is encrypted by Electron and never exposed to the terminal renderer.</p>
              <div class="test-row"><button id="test-ai" class="secondary-button" type="button">Test connection</button><span id="ai-test-status"></span></div>
            </section>
            <section class="settings-section">
              <div class="settings-section-title"><strong>Appearance</strong><span>Navigation sizing</span></div>
              <label class="range-row"><span>Sidebar width</span><input id="sidebar-width" type="range" min="210" max="480" step="1"><output id="sidebar-width-value"></output></label>
            </section>
            <section class="settings-section">
              <div class="settings-section-title"><strong>Keyboard</strong><span>Click a field, then press a shortcut</span></div>
              <div id="hotkey-grid" class="hotkey-grid"></div>
              <button id="reset-hotkeys" class="text-button" type="button">Reset keyboard shortcuts</button>
            </section>
          </div>
          <footer class="settings-footer"><span id="settings-status"></span><button class="secondary-button" id="settings-cancel" type="button">Cancel</button><button class="primary-button" type="submit">Save settings</button></footer>
        </form>
      </section>
    </div>
    <aside id="link-popover" class="link-popover" hidden></aside>
  </main>
`;

const shellElement = document.querySelector('.app-shell');
const sessionList = document.querySelector('#session-list');
const terminalStack = document.querySelector('#terminal-stack');
const activeTitle = document.querySelector('#active-title');
const activeSubtitle = document.querySelector('#active-subtitle');
const statusDot = document.querySelector('.status-dot');
const collapseButton = document.querySelector('#collapse-button');
const newSessionButton = document.querySelector('#new-session');
const toastRegion = document.querySelector('#toast-region');
const settingsBackdrop = document.querySelector('#settings-backdrop');
const settingsForm = document.querySelector('#settings-form');
const linkPopover = document.querySelector('#link-popover');
const sidebarResizer = document.querySelector('#sidebar-resizer');
const sessionDropMarker = document.createElement('div');
sessionDropMarker.className = 'session-drop-marker';
sessionDropMarker.setAttribute('aria-hidden', 'true');

function makeSessionId() {
  return `session-${crypto.randomUUID()}`;
}

function makeGroupId() {
  return `group-${crypto.randomUUID()}`;
}

function getGroup(groupId) {
  return groups.find((group) => group.id === groupId);
}

function getGroupForSession(sessionId) {
  return groups.find((group) => group.sessionIds.includes(sessionId));
}

function orderedSessionIds() {
  return groups.flatMap((group) => group.sessionIds).filter((id) => sessions.has(id));
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

const HOTKEY_LABELS = {
  copy: 'Copy selection',
  paste: 'Paste',
  newSession: 'New session',
  closeSession: 'Close session',
  toggleSidebar: 'Collapse sidebar',
  nextSession: 'Next session',
  previousSession: 'Previous session',
  openSettings: 'Open settings'
};

function applySettings() {
  settings.hotkeys = { ...DEFAULT_HOTKEYS, ...(settings.hotkeys || {}) };
  settings.sidebarWidth = Math.max(210, Math.min(480, Number(settings.sidebarWidth) || 282));
  shellElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
  newSessionButton.title = `New session in active group (${settings.hotkeys.newSession})`;
  collapseButton.title = sidebarCollapsed
    ? `Expand sidebar (${settings.hotkeys.toggleSidebar})`
    : `Collapse sidebar (${settings.hotkeys.toggleSidebar})`;
  document.querySelector('#settings-button').title = `Settings (${settings.hotkeys.openSettings})`;
  updateVisualState();
}

function renderHotkeyInputs() {
  const grid = document.querySelector('#hotkey-grid');
  grid.replaceChildren();
  for (const [action, label] of Object.entries(HOTKEY_LABELS)) {
    const row = document.createElement('label');
    row.className = 'hotkey-row';
    row.innerHTML = `<span></span><input type="text" readonly data-hotkey-action="${action}">`;
    row.querySelector('span').textContent = label;
    const input = row.querySelector('input');
    input.value = settings.hotkeys[action];
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Backspace' || event.key === 'Delete') {
        input.value = DEFAULT_HOTKEYS[action];
        return;
      }
      const accelerator = keyboardEventToAccelerator(event);
      if (accelerator) input.value = accelerator;
    });
    grid.append(row);
  }
}

function populateSettingsPanel() {
  clearApiKeyRequested = false;
  document.querySelector('#ai-enabled').checked = settings.llmEnabled;
  document.querySelector('#api-key').value = '';
  document.querySelector('#api-key').placeholder = settings.hasApiKey ? 'Encrypted key configured' : 'sk-…';
  document.querySelector('#api-key-state').textContent = settings.hasApiKey ? 'Encrypted key configured' : 'No key configured';
  document.querySelector('#clear-api-key').hidden = !settings.hasApiKey;
  document.querySelector('#ai-model').value = settings.model;
  document.querySelector('#sidebar-width').value = String(settings.sidebarWidth);
  document.querySelector('#sidebar-width-value').textContent = `${settings.sidebarWidth}px`;
  document.querySelector('#settings-status').textContent = '';
  document.querySelector('#ai-test-status').textContent = '';
  renderHotkeyInputs();
}

function openSettingsPanel() {
  populateSettingsPanel();
  settingsBackdrop.hidden = false;
  requestAnimationFrame(() => settingsBackdrop.classList.add('visible'));
}

function closeSettingsPanel() {
  applySettings();
  settingsBackdrop.classList.remove('visible');
  window.setTimeout(() => {
    settingsBackdrop.hidden = true;
    sessions.get(activeId)?.terminal.focus();
  }, 160);
}

function settingsPayload() {
  const hotkeys = {};
  for (const input of document.querySelectorAll('[data-hotkey-action]')) hotkeys[input.dataset.hotkeyAction] = input.value;
  return {
    llmEnabled: document.querySelector('#ai-enabled').checked,
    apiKey: document.querySelector('#api-key').value,
    clearApiKey: clearApiKeyRequested,
    model: document.querySelector('#ai-model').value,
    sidebarWidth: Number(document.querySelector('#sidebar-width').value),
    hotkeys
  };
}

async function saveSettingsFromPanel({ close = true } = {}) {
  const status = document.querySelector('#settings-status');
  const payload = settingsPayload();
  const assigned = Object.values(payload.hotkeys);
  if (new Set(assigned).size !== assigned.length) {
    status.textContent = 'Each action needs a unique keyboard shortcut.';
    return false;
  }
  status.textContent = 'Saving…';
  try {
    settings = await api.saveSettings(payload);
    applySettings();
    status.textContent = 'Saved';
    if (close) closeSettingsPanel();
    return true;
  } catch (error) {
    status.textContent = error.message;
    return false;
  }
}

function beginSidebarResize(event) {
  if (sidebarCollapsed) return;
  event.preventDefault();
  sidebarResizer.setPointerCapture(event.pointerId);
  shellElement.classList.add('resizing-sidebar');
  const move = (moveEvent) => {
    settings.sidebarWidth = Math.max(210, Math.min(480, moveEvent.clientX));
    shellElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
    fitActive();
  };
  const finish = async () => {
    sidebarResizer.removeEventListener('pointermove', move);
    sidebarResizer.removeEventListener('pointerup', finish);
    sidebarResizer.removeEventListener('pointercancel', finish);
    shellElement.classList.remove('resizing-sidebar');
    settings = await api.saveSettings({ ...settings, sidebarWidth: settings.sidebarWidth });
  };
  sidebarResizer.addEventListener('pointermove', move);
  sidebarResizer.addEventListener('pointerup', finish);
  sidebarResizer.addEventListener('pointercancel', finish);
}

function terminalHistory(terminal) {
  const buffer = terminal.buffer.active;
  const start = Math.max(0, buffer.length - MAX_HISTORY_LINES);
  const lines = [];
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
  }
  const history = lines.join('\n').replace(/\n+$/, '');
  return history.length > MAX_HISTORY_CHARS ? history.slice(-MAX_HISTORY_CHARS) : history;
}

function plainTerminalText(value) {
  return String(value)
    .replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function detectedAgent(commandOrOutput) {
  const text = commandOrOutput.toLowerCase();
  if (/(^|\s|\/)hermes(?:\s|$)/.test(text)) return 'Hermes';
  if (/(^|\s|\/)codex(?:\s|$)/.test(text)) return 'Codex';
  if (/(^|\s|\/)claude(?:\s|$)/.test(text)) return 'Claude';
  if (/(^|\s|\/)gemini(?:\s|$)/.test(text)) return 'Gemini';
  return '';
}

function captureLinks(session, text) {
  const matches = plainTerminalText(text).match(/https?:\/\/[^\s<>"'`]+/g) || [];
  let changed = false;
  for (const match of matches) {
    const url = match.replace(/[),.;:!?]+$/, '');
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (session.links.some((link) => link.url === normalized)) continue;
      session.links.push({ url: normalized, seenAt: Date.now() });
      changed = true;
    } catch {
      // Ignore partial URLs emitted while a terminal frame is still streaming.
    }
  }
  if (session.links.length > 100) session.links.splice(0, session.links.length - 100);
  return changed;
}

function appendSessionContext(session, text) {
  const plain = plainTerminalText(text).trim();
  if (!plain) return;
  session.context = `${session.context}\n${plain}`.slice(-MAX_CONTEXT_CHARS);
  const agent = detectedAgent(plain);
  if (agent) session.agent = agent;
  if (captureLinks(session, plain)) updateSessionItem(session);
  scheduleAiSummary(session);
}

function trackTerminalInput(session, data) {
  for (const character of data) {
    if (character === '\r' || character === '\n') {
      const command = session.commandBuffer.trim();
      if (command) {
        const agent = detectedAgent(command);
        if (agent) session.agent = agent;
        appendSessionContext(session, `$ ${command}`);
      }
      session.commandBuffer = '';
    } else if (character === '\x7f') {
      session.commandBuffer = session.commandBuffer.slice(0, -1);
    } else if (character >= ' ' && character !== '\x1b') {
      session.commandBuffer += character;
    }
  }
}

function scheduleAiSummary(session) {
  if (!settings.llmEnabled || !settings.hasApiKey || session.exited) return;
  window.clearTimeout(session.aiSummaryTimer);
  session.aiSummaryTimer = window.setTimeout(() => void requestAiSummary(session), AI_SUMMARY_SETTLE_MS);
}

async function requestAiSummary(session) {
  if (session.aiSummaryInFlight || session.context.length - session.lastSummarizedLength < 60) return;
  session.aiSummaryInFlight = true;
  try {
    const result = await api.summarizeSession({ context: session.context, agent: session.agent || 'Terminal' });
    if (!result) return;
    session.displayName = session.agent || result.name;
    session.summary = result.summary;
    session.lastSummarizedLength = session.context.length;
    updateSessionItem(session);
    schedulePersist();
  } catch (error) {
    if (!session.aiErrorShown) {
      session.aiErrorShown = true;
      showToast(`AI naming: ${error.message}`);
    }
  } finally {
    session.aiSummaryInFlight = false;
  }
}

function hideLinkPopoverSoon() {
  window.clearTimeout(linkPopoverTimer);
  linkPopoverTimer = window.setTimeout(() => {
    linkPopover.classList.remove('visible');
    window.setTimeout(() => { linkPopover.hidden = true; }, 120);
  }, 180);
}

function showLinkPopover(session, trigger) {
  if (!session.links.length) return;
  window.clearTimeout(linkPopoverTimer);
  linkPopover.replaceChildren();
  const heading = document.createElement('header');
  heading.innerHTML = `<strong>Session links</strong><span>${session.links.length} captured</span>`;
  linkPopover.append(heading);
  const list = document.createElement('div');
  list.className = 'link-popover-list';
  for (const link of session.links) {
    const button = document.createElement('button');
    button.type = 'button';
    const parsed = new URL(link.url);
    button.innerHTML = `<strong></strong><span></span><time></time>`;
    button.querySelector('strong').textContent = parsed.hostname;
    button.querySelector('span').textContent = `${parsed.pathname}${parsed.search}` || '/';
    button.querySelector('time').textContent = new Date(link.seenAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    button.addEventListener('click', () => void api.openExternal(link.url));
    list.append(button);
  }
  linkPopover.append(list);
  linkPopover.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const width = 360;
  linkPopover.style.left = `${Math.min(rect.right + 8, window.innerWidth - width - 12)}px`;
  linkPopover.style.top = `${Math.max(12, Math.min(rect.top - 8, window.innerHeight - 390))}px`;
  requestAnimationFrame(() => linkPopover.classList.add('visible'));
}

function persistWorkspaceNow() {
  if (restoringWorkspace) return;
  const savedSessions = [];
  for (const group of groups) {
    for (const id of group.sessionIds) {
      const session = sessions.get(id);
      if (!session) continue;
      savedSessions.push({
        id: session.id,
        groupId: group.id,
        title: session.title,
        shell: session.shell,
        cwd: session.cwd,
        history: terminalHistory(session.terminal),
        notified: session.notified,
        displayName: session.displayName,
        summary: session.summary,
        agent: session.agent,
        links: session.links
      });
    }
  }

  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      version: WORKSPACE_VERSION,
      groups: groups.map((group) => ({
        id: group.id,
        title: group.title,
        collapsed: group.collapsed,
        sessionIds: group.sessionIds.filter((id) => sessions.has(id))
      })),
      sessions: savedSessions,
      activeId,
      activeGroupId
    }));
  } catch {
    showToast('Workspace storage is full; older scrollback was not saved');
  }
}

function schedulePersist() {
  if (restoringWorkspace) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistWorkspaceNow, 250);
}

async function refreshRuntimeStateAndPersist() {
  if (persistInFlight || restoringWorkspace) return;
  persistInFlight = true;
  try {
    await Promise.all([...sessions.values()].map(async (session) => {
      if (session.exited) return;
      const state = await api.getSessionState(session.id);
      if (state?.cwd) session.cwd = state.cwd;
    }));
    persistWorkspaceNow();
  } finally {
    persistInFlight = false;
  }
}

function updateSidebarState() {
  shellElement.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  collapseButton.title = sidebarCollapsed
    ? `Expand sidebar (${settings.hotkeys.toggleSidebar})`
    : `Collapse sidebar (${settings.hotkeys.toggleSidebar})`;
  collapseButton.setAttribute('aria-label', sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  window.setTimeout(fitActive, 220);
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  updateSidebarState();
}

function groupNotificationCount(group) {
  return group.sessionIds.reduce((count, id) => count + (sessions.get(id)?.notified ? 1 : 0), 0);
}

function updateSessionItem(session) {
  if (!session.item) return;
  const aiLabelActive = settings.llmEnabled && settings.hasApiKey && session.summary;
  const primary = aiLabelActive
    ? `${session.agent || session.displayName || 'Terminal'}:`
    : session.title;
  const secondary = aiLabelActive
    ? session.summary
    : session.exited
      ? `${session.shell} · stopped`
      : `${session.shell} · ${session.cwd === '~' ? '~' : session.cwd.split('/').filter(Boolean).at(-1) || '/'}`;
  session.item.title = aiLabelActive ? `${primary} ${secondary}` : session.title;
  session.item.querySelector('.session-details strong').textContent = primary;
  session.item.querySelector('.session-details small').textContent = secondary;
  session.item.classList.toggle('has-notification', session.notified);
  session.item.classList.toggle('session-exited', session.exited);
  const linkTrigger = session.item.querySelector('.session-link-trigger');
  linkTrigger.hidden = session.links.length === 0;
  linkTrigger.querySelector('span').textContent = String(session.links.length);
  if (session.id === activeId) activeTitle.textContent = session.title;
}

function updateVisualState() {
  for (const session of sessions.values()) {
    const isActive = session.id === activeId;
    session.pane.classList.toggle('active', isActive);
    session.item?.classList.toggle('active', isActive);
    session.item?.setAttribute('aria-current', isActive ? 'page' : 'false');
    updateSessionItem(session);
  }
  for (const group of groups) {
    const element = sessionList.querySelector(`[data-group-id="${group.id}"]`);
    if (!element) continue;
    element.classList.toggle('active-group', group.id === activeGroupId);
    const badge = element.querySelector('.group-notification-badge');
    const notificationCount = groupNotificationCount(group);
    badge.textContent = String(notificationCount);
    badge.hidden = notificationCount === 0;
    element.querySelector('.group-session-count').textContent = String(group.sessionIds.filter((id) => sessions.has(id)).length);
  }
}

function startGroupRename(group, titleElement) {
  const original = group.title;
  titleElement.contentEditable = 'true';
  titleElement.classList.add('renaming');
  titleElement.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(titleElement);

  const finish = (commit) => {
    titleElement.contentEditable = 'false';
    titleElement.classList.remove('renaming');
    const next = titleElement.textContent.trim().slice(0, 32);
    group.title = commit && next ? next : original;
    titleElement.textContent = group.title;
    schedulePersist();
  };

  titleElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleElement.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  }, { once: false });
  titleElement.addEventListener('blur', () => finish(true), { once: true });
}

function renderGroups() {
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'session-group';
    section.dataset.groupId = group.id;
    section.classList.toggle('group-collapsed', group.collapsed);
    section.innerHTML = `
      <header class="group-header" draggable="true">
        <button class="group-toggle" type="button" aria-label="${group.collapsed ? 'Expand' : 'Collapse'} group" title="${group.collapsed ? 'Expand' : 'Collapse'} group">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5"/></svg>
        </button>
        <span class="group-grip" aria-hidden="true">⠿</span>
        <span class="group-avatar" aria-hidden="true"></span>
        <strong class="group-title" title="Double-click to rename"></strong>
        <span class="group-session-count"></span>
        <span class="group-notification-badge" hidden></span>
        <button class="group-delete" type="button" aria-label="Delete group" title="Delete group">×</button>
      </header>
      <div class="group-sessions" role="list"></div>
    `;
    section.querySelector('.group-avatar').textContent = group.title.slice(0, 1).toUpperCase();
    const title = section.querySelector('.group-title');
    title.textContent = group.title;
    title.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      startGroupRename(group, title);
    });
    section.querySelector('.group-toggle').addEventListener('click', (event) => {
      event.stopPropagation();
      group.collapsed = !group.collapsed;
      renderGroups();
      schedulePersist();
    });
    section.querySelector('.group-delete').addEventListener('click', (event) => {
      event.stopPropagation();
      deleteGroup(group.id);
    });
    section.querySelector('.group-header').addEventListener('click', (event) => {
      if (event.target.closest('button') || title.isContentEditable) return;
      activeGroupId = group.id;
      updateVisualState();
      schedulePersist();
    });
    const body = section.querySelector('.group-sessions');
    for (const sessionId of group.sessionIds) {
      const item = sessions.get(sessionId)?.item;
      if (item) body.append(item);
    }
    fragment.append(section);
  }
  sessionList.replaceChildren(fragment);
  updateVisualState();
}

function renderSessionItem(session) {
  const item = document.createElement('button');
  item.type = 'button';
  item.draggable = true;
  item.className = 'session-item';
  item.dataset.sessionId = session.id;
  item.setAttribute('role', 'listitem');
  item.innerHTML = `
    <span class="session-icon-wrap">
      <span class="session-icon">›_</span>
      <span class="notification-dot" aria-label="Session needs attention"></span>
    </span>
    <span class="session-details">
      <strong></strong>
      <small></small>
    </span>
    <span class="session-item-actions">
      <span class="session-link-trigger" role="button" aria-label="Show captured links" title="Captured links" hidden>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5 9.5 6.5M5.2 11.8l-1 .9a2.8 2.8 0 0 1-4-4l2.5-2.5a2.8 2.8 0 0 1 4 0M10.8 4.2l1-.9a2.8 2.8 0 0 1 4 4l-2.5 2.5a2.8 2.8 0 0 1-4 0"/></svg><span>0</span>
      </span>
      <span class="session-close" role="button" aria-label="Close session" title="Close session">×</span>
    </span>
  `;
  item.addEventListener('click', (event) => {
    if (event.target.closest('.session-close')) {
      event.stopPropagation();
      closeSession(session.id);
      return;
    }
    activateSession(session.id);
  });
  const linkTrigger = item.querySelector('.session-link-trigger');
  linkTrigger.addEventListener('mouseenter', () => showLinkPopover(session, linkTrigger));
  linkTrigger.addEventListener('mouseleave', hideLinkPopoverSoon);
  linkTrigger.addEventListener('click', (event) => event.stopPropagation());
  session.item = item;
  updateSessionItem(session);
}

function activateSession(id) {
  const next = sessions.get(id);
  if (!next) return;
  activeId = id;
  const group = getGroupForSession(id);
  if (group) {
    activeGroupId = group.id;
    if (group.collapsed) {
      group.collapsed = false;
      renderGroups();
    }
  }
  next.notified = false;
  window.clearTimeout(next.notificationTimer);
  activeTitle.textContent = next.title;
  activeSubtitle.textContent = next.exited
    ? `${next.shell} · stopped · ${next.cwd}`
    : `${next.shell} · ${next.cwd}`;
  statusDot.classList.toggle('stopped', next.exited);
  updateVisualState();
  schedulePersist();
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
  if (!session || session.exited) return;
  const text = await api.readClipboard();
  if (text) session.terminal.paste(text);
  session.terminal.focus();
}

function cycleSession(direction) {
  const ids = orderedSessionIds();
  if (ids.length < 2) return;
  const index = ids.indexOf(activeId);
  activateSession(ids[(index + direction + ids.length) % ids.length]);
}

function markSessionNotification(session) {
  if (!session || session.id === activeId || session.notified) return;
  session.notified = true;
  updateSessionItem(session);
  updateVisualState();
  schedulePersist();
}

function noteBackgroundActivity(session, data) {
  if (!session || session.id === activeId) return;
  window.clearTimeout(session.notificationTimer);
  window.clearTimeout(session.aiSummaryTimer);
  if (data.includes('\x07')) {
    markSessionNotification(session);
    return;
  }
  session.notificationTimer = window.setTimeout(() => {
    if (session.id !== activeId && !session.exited) markSessionNotification(session);
  }, BACKGROUND_SETTLE_MS);
}

async function addSession(cwd, options = {}) {
  const group = getGroup(options.groupId) || getGroup(activeGroupId) || groups[0];
  const id = options.id || makeSessionId();
  if (sessions.has(id)) return sessions.get(id);
  if (!group.sessionIds.includes(id)) group.sessionIds.push(id);
  activeGroupId = group.id;

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
      background: '#0c0c0c', foreground: '#f2f2f2', cursor: '#f2f2f2', cursorAccent: '#0c0c0c', selectionBackground: '#264f78',
      black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
      brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2'
    }
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(pane);

  const session = {
    id,
    title: options.title || `Terminal ${sessions.size + 1}`,
    shell: options.shell || 'shell',
    cwd: cwd || '~',
    terminal,
    fit,
    pane,
    item: null,
    exited: false,
    notified: Boolean(options.notified),
    notificationTimer: null,
    displayName: options.displayName || '',
    summary: options.summary || '',
    agent: options.agent || '',
    links: Array.isArray(options.links) ? options.links : [],
    context: '',
    commandBuffer: '',
    aiSummaryTimer: null,
    aiSummaryInFlight: false,
    aiErrorShown: false,
    lastSummarizedLength: 0
  };
  sessions.set(id, session);
  renderSessionItem(session);
  renderGroups();

  if (options.history) {
    const restored = options.history.replace(/\r?\n/g, '\r\n');
    terminal.write(`\x1b[2m── restored scrollback ──\x1b[0m\r\n${restored}\r\n\x1b[2m── new shell ──\x1b[0m\r\n`);
  }

  terminal.onData((data) => {
    if (!session.exited) {
      trackTerminalInput(session, data);
      api.write(id, data);
    }
  });
  terminal.onResize(({ cols, rows }) => api.resize(id, cols, rows));
  terminal.onTitleChange((title) => {
    const cleaned = title.trim();
    if (!cleaned) return;
    session.title = cleaned.length > 34 ? `${cleaned.slice(0, 31)}…` : cleaned;
    updateSessionItem(session);
    schedulePersist();
  });
  terminal.onBell(() => markSessionNotification(session));
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const action = resolveTerminalShortcut(event, terminal.hasSelection(), settings.hotkeys);
    if (!action) return true;
    if (!consumeTerminalShortcutEvent(event, action)) return true;
    if (action === 'copy') void copySelection();
    if (action === 'paste') void pasteClipboard();
    if (action === 'new-session') void addSession(session.cwd, { groupId: getGroupForSession(session.id)?.id });
    if (action === 'close-session') closeSession(activeId);
    if (action === 'toggle-sidebar') toggleSidebar();
    if (action === 'next-session') cycleSession(1);
    if (action === 'previous-session') cycleSession(-1);
    if (action === 'open-settings') openSettingsPanel();
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
    updateSessionItem(session);
  } catch (error) {
    session.exited = true;
    terminal.options.disableStdin = true;
    terminal.writeln(`\r\n\x1b[31mCould not start the shell: ${error.message}\x1b[0m`);
    updateSessionItem(session);
  }

  if (options.activate !== false) activateSession(id);
  schedulePersist();
  return session;
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  const ids = orderedSessionIds();
  const index = ids.indexOf(id);
  if (!session.exited) api.close(id);
  window.clearTimeout(session.notificationTimer);
  session.terminal.dispose();
  session.pane.remove();
  session.item.remove();
  sessions.delete(id);
  groups = removeSessionFromGroups(groups, id);

  if (sessions.size === 0) {
    activeId = null;
    renderGroups();
    void addSession(undefined, { groupId: activeGroupId });
    return;
  }
  if (activeId === id) {
    const remaining = orderedSessionIds();
    activateSession(remaining[Math.min(index, remaining.length - 1)]);
  }
  renderGroups();
  schedulePersist();
}

function createNewGroup() {
  const group = createGroup(makeGroupId(), `Group ${groups.length + 1}`);
  groups.push(group);
  activeGroupId = group.id;
  if (sidebarCollapsed) {
    sidebarCollapsed = false;
    updateSidebarState();
  }
  renderGroups();
  schedulePersist();
  requestAnimationFrame(() => {
    const title = sessionList.querySelector(`[data-group-id="${group.id}"] .group-title`);
    if (title) startGroupRename(group, title);
  });
}

function deleteGroup(groupId) {
  if (groups.length === 1) {
    showToast('SideTerm needs at least one group');
    return;
  }
  const index = groups.findIndex((group) => group.id === groupId);
  if (index < 0) return;
  const removed = groups[index];
  const fallback = groups[index > 0 ? index - 1 : index + 1];
  fallback.sessionIds.push(...removed.sessionIds);
  groups = groups.filter((group) => group.id !== groupId);
  if (activeGroupId === groupId) activeGroupId = fallback.id;
  renderGroups();
  schedulePersist();
}

function groupElementAt(clientY, eventTarget) {
  const direct = eventTarget instanceof Element ? eventTarget.closest('.session-group') : null;
  if (direct) return direct;
  const elements = [...sessionList.querySelectorAll('.session-group')];
  return elements.reduce((nearest, element) => {
    const rect = element.getBoundingClientRect();
    const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    return !nearest || distance < nearest.distance ? { element, distance } : nearest;
  }, null)?.element ?? null;
}

function clearDropIndicators() {
  sessionDropMarker.remove();
  for (const element of sessionList.querySelectorAll('.session-group')) {
    element.classList.remove('drop-focus', 'drop-before', 'drop-after', 'drop-at-end');
  }
}

function cleanupDrag() {
  clearDropIndicators();
  sessionList.classList.remove('is-dragging', 'dragging-group', 'dragging-session');
  for (const element of sessionList.querySelectorAll('[aria-grabbed="true"]')) element.setAttribute('aria-grabbed', 'false');
  dragState = null;
  dropTarget = null;
}

function autoScrollDrag(clientY) {
  const rect = sessionList.getBoundingClientRect();
  if (clientY < rect.top + 36) sessionList.scrollBy({ top: -10 });
  if (clientY > rect.bottom - 36) sessionList.scrollBy({ top: 10 });
}

sessionList.addEventListener('dragstart', (event) => {
  const sessionItem = event.target.closest('.session-item');
  if (sessionItem) {
    dragState = { type: 'session', id: sessionItem.dataset.sessionId };
    sessionItem.setAttribute('aria-grabbed', 'true');
  } else {
    const header = event.target.closest('.group-header');
    if (!header || event.target.closest('button') || event.target.isContentEditable) {
      event.preventDefault();
      return;
    }
    dragState = { type: 'group', id: header.closest('.session-group').dataset.groupId };
    header.setAttribute('aria-grabbed', 'true');
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragState.id);
  requestAnimationFrame(() => {
    sessionList.classList.add('is-dragging', `dragging-${dragState.type}`);
  });
});

sessionList.addEventListener('dragover', (event) => {
  if (!dragState) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  autoScrollDrag(event.clientY);
  clearDropIndicators();
  const groupElement = groupElementAt(event.clientY, event.target);
  if (!groupElement) return;
  groupElement.classList.add('drop-focus');
  const groupId = groupElement.dataset.groupId;

  if (dragState.type === 'group') {
    const rect = groupElement.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    groupElement.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    dropTarget = { groupId, position };
    return;
  }

  const group = getGroup(groupId);
  const body = groupElement.querySelector('.group-sessions');
  if (group.collapsed) {
    groupElement.classList.add('drop-at-end');
    dropTarget = { groupId, beforeSessionId: null };
    return;
  }
  const candidates = [...body.querySelectorAll('.session-item')]
    .filter((item) => item.dataset.sessionId !== dragState.id);
  const before = candidates.find((item) => event.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
  body.insertBefore(sessionDropMarker, before || null);
  dropTarget = { groupId, beforeSessionId: before?.dataset.sessionId ?? null };
});

sessionList.addEventListener('drop', (event) => {
  if (!dragState || !dropTarget) return;
  event.preventDefault();
  if (dragState.type === 'group') {
    groups = reorderGroup(groups, dragState.id, dropTarget.groupId, dropTarget.position);
  } else {
    groups = moveSession(groups, dragState.id, dropTarget.groupId, dropTarget.beforeSessionId);
    activeGroupId = dropTarget.groupId;
  }
  cleanupDrag();
  renderGroups();
  schedulePersist();
});

sessionList.addEventListener('dragend', cleanupDrag);

api.onData(({ id, data }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.terminal.write(data);
  appendSessionContext(session, data);
  noteBackgroundActivity(session, data);
});

api.onExit(({ id, exitCode }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.exited = true;
  session.terminal.options.disableStdin = true;
  session.terminal.writeln(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m`);
  if (id === activeId) {
    activeSubtitle.textContent = `${session.shell} · stopped · ${session.cwd}`;
    statusDot.classList.add('stopped');
  } else {
    markSessionNotification(session);
  }
  updateSessionItem(session);
  updateVisualState();
  schedulePersist();
});

new ResizeObserver(fitActive).observe(terminalStack);
window.addEventListener('resize', fitActive);
collapseButton.addEventListener('click', toggleSidebar);
newSessionButton.addEventListener('click', () => void addSession(sessions.get(activeId)?.cwd, { groupId: activeGroupId }));
document.querySelector('#new-group').addEventListener('click', createNewGroup);
document.querySelector('#heading-new-group').addEventListener('click', createNewGroup);
document.querySelector('#copy-button').addEventListener('click', () => void copySelection());
document.querySelector('#paste-button').addEventListener('click', () => void pasteClipboard());
document.querySelector('#open-folder-button').addEventListener('click', () => {
  const session = sessions.get(activeId);
  if (session) void api.openPath(session.cwd);
});
document.querySelector('#settings-button').addEventListener('click', openSettingsPanel);
document.querySelector('#settings-close').addEventListener('click', closeSettingsPanel);
document.querySelector('#settings-cancel').addEventListener('click', closeSettingsPanel);
settingsBackdrop.addEventListener('mousedown', (event) => {
  if (event.target === settingsBackdrop) closeSettingsPanel();
});
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveSettingsFromPanel();
});
document.querySelector('#sidebar-width').addEventListener('input', (event) => {
  const width = Number(event.target.value);
  document.querySelector('#sidebar-width-value').textContent = `${width}px`;
  shellElement.style.setProperty('--sidebar-width', `${width}px`);
  window.setTimeout(fitActive, 0);
});
document.querySelector('#reset-hotkeys').addEventListener('click', () => {
  for (const input of document.querySelectorAll('[data-hotkey-action]')) input.value = DEFAULT_HOTKEYS[input.dataset.hotkeyAction];
});
document.querySelector('#clear-api-key').addEventListener('click', () => {
  clearApiKeyRequested = true;
  document.querySelector('#api-key').value = '';
  document.querySelector('#api-key-state').textContent = 'Key will be removed when saved';
  document.querySelector('#clear-api-key').hidden = true;
  document.querySelector('#ai-enabled').checked = false;
});
document.querySelector('#api-key').addEventListener('input', (event) => {
  if (event.target.value) clearApiKeyRequested = false;
});
document.querySelector('#test-ai').addEventListener('click', async () => {
  const status = document.querySelector('#ai-test-status');
  status.textContent = 'Testing…';
  if (!await saveSettingsFromPanel({ close: false })) {
    status.textContent = 'Save failed';
    return;
  }
  try {
    const result = await api.testAiSettings();
    status.textContent = `Connected · ${result.name}: ${result.summary}`;
  } catch (error) {
    status.textContent = error.message;
  }
});
sidebarResizer.addEventListener('pointerdown', beginSidebarResize);
linkPopover.addEventListener('mouseenter', () => window.clearTimeout(linkPopoverTimer));
linkPopover.addEventListener('mouseleave', hideLinkPopoverSoon);

window.addEventListener('keydown', (event) => {
  if (!settingsBackdrop.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeSettingsPanel();
    return;
  }
  if (event.target instanceof Element && event.target.closest('.settings-panel')) return;
  if (event.target instanceof Element && event.target.closest('.xterm')) return;
  const action = resolveTerminalShortcut(event, sessions.get(activeId)?.terminal.hasSelection() ?? false, settings.hotkeys);
  if (!action || action === 'terminal-input') return;
  event.preventDefault();
  if (action === 'copy') void copySelection();
  if (action === 'paste') void pasteClipboard();
  if (action === 'new-session') void addSession(sessions.get(activeId)?.cwd, { groupId: activeGroupId });
  if (action === 'close-session') closeSession(activeId);
  if (action === 'toggle-sidebar') toggleSidebar();
  if (action === 'next-session') cycleSession(1);
  if (action === 'previous-session') cycleSession(-1);
  if (action === 'open-settings') openSettingsPanel();
});

window.addEventListener('beforeunload', persistWorkspaceNow);
window.setInterval(() => void refreshRuntimeStateAndPersist(), 2_000);

async function restoreSavedWorkspace() {
  renderGroups();
  const descriptors = new Map((restoredWorkspace?.sessions ?? []).map((session) => [session.id, session]));
  const restoreOrder = groups.flatMap((group) => group.sessionIds);
  for (const id of restoreOrder) {
    const saved = descriptors.get(id);
    if (!saved) continue;
    await addSession(saved.cwd, {
      id: saved.id,
      groupId: getGroupForSession(saved.id)?.id ?? saved.groupId,
      title: saved.title,
      shell: saved.shell,
      history: saved.history,
      notified: saved.notified,
      displayName: saved.displayName,
      summary: saved.summary,
      agent: saved.agent,
      links: saved.links,
      activate: false
    });
  }
  restoringWorkspace = false;
  if (sessions.size === 0) {
    await addSession(undefined, { groupId: activeGroupId });
  } else {
    const restoredActive = restoredWorkspace?.activeId;
    activateSession(sessions.has(restoredActive) ? restoredActive : orderedSessionIds()[0]);
  }
  persistWorkspaceNow();
}

async function initializeApp() {
  try {
    settings = await api.getSettings();
  } catch {
    // Defaults keep the terminal functional if settings cannot be read.
  }
  applySettings();
  updateSidebarState();
  await restoreSavedWorkspace();
}

void initializeApp();
