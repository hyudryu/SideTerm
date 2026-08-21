import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import QRCode from 'qrcode';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { agentActivityState, canAutoArmAgentActivity, consumeTerminalInputEcho, isBareAgentLaunchCommand, isForegroundSession, normalizeGithubPullRequestUrl, restoredContextState, scanTerminalUrls, shouldKeepSessionBusy, stripTerminalControlInput, terminalStatusRowRange, terminalWheelAmount } from './activity.js';
import { aiSummaryRetryDelay, MAX_AI_SUMMARY_FAILURES, shouldRearmAiSummary } from './ai-summary.js';
import { renderMarkdown } from './markdown.js';
import { sessionDisplayLabels } from './session-labels.js';
import { createTerminalLinkProvider, openTerminalLink } from './terminal-links.js';
import { releaseStaleMouseDrag } from './pointer-release.js';
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
  newestSavedWorkspace,
  parseSavedWorkspace,
  removeSessionFromGroups,
  reorderGroup,
  sortedSessionIds
} from './workspace.js';

const api = window.sideTerm;
const WORKSPACE_KEY = 'sidetermWorkspace';
const MAX_HISTORY_LINES = 400;
const MAX_HISTORY_CHARS = 120_000;
const SESSION_BUSY_SETTLE_MS = 1_400;
const SESSION_BUSY_UNKNOWN_GRACE_MS = 5_000;
const ACTIVATION_REDRAW_SUPPRESS_MS = 900;
const AI_INITIAL_CONTEXT_DELAY_MS = 30_000;
const AI_SUMMARY_REQUEST_TIMEOUT_MS = 15_000;
const AI_SUMMARY_RETRY_DELAY_MS = 30_000;
const AI_SUMMARY_FAILURE_COOLDOWN_MS = 5 * 60_000;
const MAX_CONTEXT_CHARS = 16_000;
const VOICE_REPLY_WINDOW_MS = 30_000;
const GROUP_SORT_OPTIONS = [
  { value: 'default', label: 'Default', initialDirection: 'asc' },
  { value: 'created', label: 'Date created', initialDirection: 'desc' },
  { value: 'response', label: 'Last response', initialDirection: 'desc' },
  { value: 'name', label: 'Name', initialDirection: 'asc' }
];
const sessions = new Map();
const restoredWorkspace = newestSavedWorkspace(
  parseSavedWorkspace(api.getWorkspaceSync()),
  parseSavedWorkspace(localStorage.getItem(WORKSPACE_KEY))
);
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
let clearSttCredentialRequested = false;
let settings = {
  appVersion: '',
  llmEnabled: false,
  aiInitialContextEnabled: true,
  aiContinuousContextEnabled: true,
  aiContextIntervalMinutes: 30,
  hasApiKey: false,
  apiUrl: '',
  model: '',
  agentEnabled: false,
  personality: 'Warm, direct, calm, and concise.',
  agentInstructions: '',
  wakeWord: 'Hey Agent',
  sttProvider: 'parakeet',
  sttModel: 'nvidia/parakeet-tdt-0.6b-v2',
  sttEndpoint: '',
  sttRegion: '',
  hasSttCredential: false,
  githubCodexActorLogins: ['chatgpt-codex-connector', 'codex', 'openai-codex'],
  ttsModel: 'kyutai/pocket-tts',
  ttsVoice: 'alba',
  ttsSpeed: 1,
  sidebarWidth: 282,
  hotkeys: { ...DEFAULT_HOTKEYS }
};
let linkPopoverTimer = null;
let agentState = { enabled: false, status: 'idle', messages: [], notifications: [], archivedSessions: [], confirmations: [] };
let agentCatchUpInFlight = false;
let supervisorDashboardActive = false;
let desktopVoiceMode = false;
let voiceStream = null;
let voiceAudioContext = null;
let voiceMonitorFrame = null;
let voiceRecorder = null;
let voiceCaptureMuted = false;
let voiceTranscriptionInFlight = false;
let activeVoicePlayer = null;
let voiceBargeInStartedAt = 0;
let voiceReplyUntil = 0;
let voiceReplyInteractionId = '';
let agentSpeechQueue = Promise.resolve(true);
let providerValidationInFlight = false;
let aiSummaryGlobalInFlight = false;
let aiSummaryCooldownUntil = 0;

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
      <div class="sidebar-footer-actions">
        <button id="settings-button" class="settings-button" type="button" title="Settings (Ctrl+,)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.37.55.72 1 .9.35.15.73.2 1.1.1h.1v4h-.09a1.7 1.7 0 0 0-1.51.6c-.28.28-.48.62-.6 1Z"/></svg>
          <span class="action-label">Settings</span>
        </button>
        <button id="agent-button" class="agent-button" type="button" title="Open supervisor dashboard" aria-label="Open supervisor dashboard">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v2a4 4 0 0 0 2 3.46V17h3l1 2 1-2h3v-2.54A4 4 0 0 0 18 11V9a6 6 0 0 0-6-6Z"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/></svg>
          <span class="agent-unread-badge" hidden>0</span>
        </button>
        <button id="mobile-button" class="mobile-button" type="button" title="Connect from mobile" aria-label="Connect from mobile">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></svg>
        </button>
      </div>
      <div id="sidebar-resizer" class="sidebar-resizer" title="Drag to resize sidebar"></div>
    </aside>
    <section class="workspace">
      <header class="command-bar">
        <div class="active-session-heading">
          <span class="status-dot"></span>
          <div>
            <strong id="active-title" title="Click to rename session">Terminal</strong>
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
      <section id="supervisor-dashboard" class="supervisor-dashboard" aria-labelledby="agent-panel-title" hidden>
        <header class="supervisor-dashboard-header">
          <div>
            <span class="supervisor-kicker">SUPERVISOR</span>
            <strong id="agent-panel-title">Session command center</strong>
            <small>Persistent Strands agent across every terminal session</small>
          </div>
          <button id="agent-close" class="secondary-button" type="button">Back to terminal</button>
        </header>
        <div class="agent-panel-body">
          <div class="agent-overview"><span id="agent-status-dot"></span><div><strong id="agent-status-label">Idle</strong><small id="agent-status-detail">Ready to help</small></div><button id="desktop-voice-toggle" class="secondary-button" type="button">Voice off</button></div>
          <section class="agent-metrics" aria-label="Supervisor metrics">
            <article><span>Pending sessions</span><strong id="agent-metric-pending">0</strong></article>
            <article><span>Running now</span><strong id="agent-metric-running">0</strong></article>
            <article><span>Agent inputs</span><strong id="agent-metric-inputs">0</strong></article>
            <article><span>Words saved typing</span><strong id="agent-metric-words">0</strong></article>
          </section>
          <section class="agent-pending-section"><header><strong>Pending sessions</strong><span>Running or awaiting attention</span></header><div id="agent-pending-sessions" class="agent-pending-sessions"></div></section>
          <section class="agent-pull-section"><header><strong>GitHub pull requests</strong><span>Checked every minute after a push</span></header><div id="agent-pull-requests" class="agent-pull-requests"></div></section>
          <section class="agent-notification-section"><header><strong>Notifications</strong><span id="agent-notification-count">0</span></header><div id="agent-notifications" class="agent-notifications"></div></section>
          <div id="agent-chat" class="agent-chat" aria-live="polite"></div>
          <div id="agent-confirmations" class="agent-confirmations"></div>
          <form id="agent-chat-form" class="agent-chat-form"><textarea id="agent-chat-input" rows="2" placeholder="Ask about a session, create work, or request terminal input…"></textarea><button class="primary-button" type="submit">Send</button></form>
        </div>
      </section>
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
              <div class="settings-section-title"><strong>LLM Provider</strong><span>OpenAI-compatible</span></div>
              <label class="field-row"><span>API URL</span><input id="ai-api-url" type="url" autocomplete="off" placeholder="http://localhost:11434/v1" spellcheck="false"></label>
              <label class="field-row"><span>API key <small>(optional)</small></span><input id="api-key" type="password" autocomplete="off" placeholder="Provider key"></label>
              <div class="credential-actions"><span id="api-key-state">No key configured</span><button id="clear-api-key" type="button">Clear key</button></div>
              <label class="field-row"><span>Model name</span><input id="ai-model" type="text" placeholder="Your provider's model ID" spellcheck="false"></label>
              <p class="settings-note">Uses the OpenAI-compatible Chat Completions format. Enter a base URL such as <code>http://localhost:11434/v1</code>, or the full <code>/chat/completions</code> URL. Provider keys are encrypted by Electron and never exposed to the terminal renderer.</p>
              <div class="test-row"><button id="test-ai" class="secondary-button" type="button">Test connection</button><span id="ai-test-status"></span></div>
            </section>
            <section class="settings-section settings-toggle-section">
              <label class="toggle-row">
                <span><strong>AI session context <em class="llm-required-label">LLM required</em></strong><small>Use the configured provider to name and summarize terminal sessions.</small></span>
                <input id="ai-enabled" type="checkbox"><i></i>
              </label>
              <div class="ai-context-options">
                <label class="toggle-row compact-toggle-row">
                  <span><strong>Initial context</strong><small>Label a new session once, 30 seconds after its first meaningful prompt.</small></span>
                  <input id="ai-initial-context-enabled" type="checkbox"><i></i>
                </label>
                <label class="toggle-row compact-toggle-row">
                  <span><strong>Continuous context update</strong><small>Refresh the label from the latest terminal context.</small></span>
                  <input id="ai-continuous-context-enabled" type="checkbox"><i></i>
                </label>
                <label class="context-interval-row"><span>Update every</span><input id="ai-context-interval-minutes" type="number" min="1" max="1440" step="1"><span>minutes</span></label>
              </div>
            </section>
            <section class="settings-section">
              <div class="settings-section-title"><strong>Supervisor</strong><span>Persistent human assistant</span></div>
              <label class="toggle-row">
                <span><strong>Enable Supervisor <em class="llm-required-label">LLM required</em></strong><small>Track completed session work and enable the desktop/mobile agent dashboard.</small></span>
                <input id="agent-enabled" type="checkbox"><i></i>
              </label>
              <label class="text-area-row"><span>Personality</span><textarea id="agent-personality" rows="3" maxlength="2000" placeholder="Warm, direct, calm, and concise."></textarea></label>
              <label class="text-area-row"><span>Agent instructions</span><textarea id="agent-instructions" rows="5" maxlength="8000" placeholder="Always confirm before finalizing terminal input…"></textarea></label>
              <label class="field-row"><span>Codex GitHub logins</span><input id="github-codex-actors" type="text" spellcheck="false" placeholder="chatgpt-codex-connector, codex, openai-codex"></label>
              <p class="settings-note">The supervisor can inspect bounded session context, create and name sessions, and propose terminal input or archival. Terminal writes and archival always require your approval.</p>
            </section>
            <section class="settings-section">
              <div class="settings-section-title"><strong>Voice mode</strong><span>Local by default · cloud is explicit opt in</span></div>
              <label class="field-row"><span>Wake word</span><input id="voice-wake-word" type="text" maxlength="80" placeholder="Hey Agent"></label>
              <div class="model-install-row"><label><span>Speech to text</span><select id="stt-provider"><option value="parakeet">LOCAL — NVIDIA Parakeet</option><option value="deepgram">CLOUD — Deepgram</option><option value="google">CLOUD — Google</option><option value="azure">CLOUD — Azure</option><option value="aws">CLOUD — AWS</option><option value="openai">CLOUD — OpenAI</option></select><select id="stt-model" hidden><option value="nvidia/parakeet-tdt-0.6b-v2">NVIDIA Parakeet TDT 0.6B V2</option></select></label><button id="install-stt" class="secondary-button" type="button">Install</button><span id="stt-status">Checking…</span></div>
              <label class="field-row" id="stt-credential-row"><span>Cloud STT credential</span><input id="stt-credential" type="password" autocomplete="off" placeholder="Selected provider credential"></label>
              <div class="credential-actions" id="stt-credential-actions"><span id="stt-credential-state">No cloud credential configured</span><button id="clear-stt-credential" type="button">Clear credential</button></div>
              <label class="field-row" id="stt-endpoint-row"><span>Cloud endpoint <small>(optional)</small></span><input id="stt-endpoint" type="url" autocomplete="off" spellcheck="false"></label>
              <label class="field-row" id="stt-region-row"><span>Cloud region <small>(Azure/AWS)</small></span><input id="stt-region" type="text" autocomplete="off" spellcheck="false"></label>
              <div class="model-install-row"><label><span>Text to speech</span><select id="tts-model"><option value="kyutai/pocket-tts">Kyutai Pocket TTS</option></select></label><button id="install-tts" class="secondary-button" type="button">Install</button><span id="tts-status">Checking…</span></div>
              <div class="voice-picker-row"><label><span>Pocket TTS voice</span><select id="tts-voice"><option>alba</option><option>marius</option><option>javert</option><option>jean</option><option>fantine</option><option>cosette</option><option>eponine</option><option>azelma</option></select></label><button id="preview-voice" class="secondary-button" type="button">Play preview</button></div>
              <label class="range-row"><span>Voice speed</span><input id="tts-speed" type="range" min="0.75" max="1.5" step="0.05"><output id="tts-speed-value">1.00×</output></label>
              <p class="settings-note">LOCAL — Parakeet keeps microphone audio on this device and never falls back to cloud transcription. Pocket TTS is a small English voice model that runs on CPU.</p>
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
          <footer class="settings-footer"><span id="settings-version" class="settings-version"></span><span id="settings-status"></span><button class="secondary-button" id="settings-cancel" type="button">Cancel</button><button class="primary-button" type="submit">Save settings</button></footer>
        </form>
      </section>
    </div>
    <div id="mobile-backdrop" class="settings-backdrop" hidden>
      <section class="mobile-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-title">
        <header class="settings-header">
          <div><strong id="mobile-title">SideTerm on mobile</strong><span>Secure browser access to your running sessions</span></div>
          <button id="mobile-close" class="settings-close" type="button" aria-label="Close mobile setup">×</button>
        </header>
        <div class="mobile-panel-body">
          <div class="mobile-status-row"><span id="mobile-status-dot"></span><strong id="mobile-status">Checking mobile access…</strong><button id="mobile-toggle" class="primary-button" type="button">Enable</button></div>
          <p>SideTerm runs a private web app from this Ubuntu computer. The long address contains its access key—only share it with your own devices.</p>
          <div id="mobile-urls" class="mobile-urls"></div>
          <div class="tailscale-https-row"><div><strong>Secure mobile voice</strong><span id="tailscale-https-status">Checking Tailscale HTTPS…</span></div><button id="enable-tailscale-https" class="secondary-button" type="button">Enable HTTPS</button></div>
          <section class="mobile-steps">
            <strong>Set up your phone</strong>
            <ol>
              <li>Connect the phone and this computer through Tailscale, or use the same local network.</li>
              <li>Open the Tailscale or local-network URL below in your phone browser. <code>localhost</code> works only on this computer.</li>
              <li>Use <strong>Add to Home Screen</strong> or <strong>Install app</strong> from the browser menu.</li>
            </ol>
          </section>
          <p class="mobile-security-note">Disabling mobile access immediately closes connected phones. SideTerm must remain running for the mobile app to connect.</p>
        </div>
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
const mobileBackdrop = document.querySelector('#mobile-backdrop');
const supervisorDashboard = document.querySelector('#supervisor-dashboard');
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
  return groups.flatMap((group) => sortedSessionIds(group, sessions));
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
  if (groups.some((group) => group.sortBy === 'name')) {
    for (const session of sessions.values()) updateSessionItem(session);
    renderGroups();
  } else {
    updateVisualState();
  }
  syncAiContextSchedules();
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
  clearSttCredentialRequested = false;
  document.querySelector('#settings-version').textContent = settings.appVersion ? `SideTerm v${settings.appVersion}` : 'SideTerm';
  document.querySelector('#ai-enabled').checked = settings.llmEnabled;
  document.querySelector('#ai-initial-context-enabled').checked = settings.aiInitialContextEnabled;
  document.querySelector('#ai-continuous-context-enabled').checked = settings.aiContinuousContextEnabled;
  document.querySelector('#ai-context-interval-minutes').value = String(settings.aiContextIntervalMinutes || 30);
  document.querySelector('#api-key').value = '';
  document.querySelector('#api-key').placeholder = settings.hasApiKey ? 'Encrypted key configured' : 'Provider key';
  document.querySelector('#api-key-state').textContent = settings.hasApiKey ? 'Encrypted key configured' : 'No key configured';
  document.querySelector('#clear-api-key').hidden = !settings.hasApiKey;
  document.querySelector('#ai-api-url').value = settings.apiUrl || '';
  document.querySelector('#ai-model').value = settings.model;
  document.querySelector('#agent-enabled').checked = settings.agentEnabled;
  document.querySelector('#agent-personality').value = settings.personality || '';
  document.querySelector('#agent-instructions').value = settings.agentInstructions || '';
  document.querySelector('#github-codex-actors').value = (settings.githubCodexActorLogins || []).join(', ');
  document.querySelector('#voice-wake-word').value = settings.wakeWord || '';
  document.querySelector('#stt-provider').value = settings.sttProvider || 'parakeet';
  document.querySelector('#stt-model').value = settings.sttModel || 'nvidia/parakeet-tdt-0.6b-v2';
  document.querySelector('#stt-credential').value = '';
  document.querySelector('#stt-credential').placeholder = settings.hasSttCredential ? 'Encrypted credential configured' : 'Selected provider credential';
  document.querySelector('#stt-credential-state').textContent = settings.hasSttCredential ? 'Encrypted credential configured' : 'No cloud credential configured';
  document.querySelector('#clear-stt-credential').hidden = !settings.hasSttCredential;
  document.querySelector('#stt-endpoint').value = settings.sttEndpoint || '';
  document.querySelector('#stt-region').value = settings.sttRegion || '';
  document.querySelector('#tts-model').value = settings.ttsModel || 'kyutai/pocket-tts';
  document.querySelector('#tts-voice').value = settings.ttsVoice || 'alba';
  document.querySelector('#tts-speed').value = String(settings.ttsSpeed || 1);
  document.querySelector('#tts-speed-value').textContent = `${Number(settings.ttsSpeed || 1).toFixed(2)}×`;
  document.querySelector('#sidebar-width').value = String(settings.sidebarWidth);
  document.querySelector('#sidebar-width-value').textContent = `${settings.sidebarWidth}px`;
  document.querySelector('#settings-status').textContent = '';
  document.querySelector('#ai-test-status').textContent = '';
  renderHotkeyInputs();
  syncProviderFeatureAvailability();
  void refreshSpeechStatus();
  syncSttProviderFields();
}

async function openSettingsPanel() {
  settings = await api.getSettings().catch(() => settings);
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

function syncSttProviderFields() {
  const provider = document.querySelector('#stt-provider').value;
  const cloud = provider !== 'parakeet';
  document.querySelector('#stt-credential-row').hidden = !cloud;
  document.querySelector('#stt-credential-actions').hidden = !cloud;
  document.querySelector('#stt-endpoint-row').hidden = !cloud;
  document.querySelector('#stt-region-row').hidden = !['azure', 'aws'].includes(provider);
  document.querySelector('#install-stt').hidden = cloud;
}

function settingsPayload() {
  const hotkeys = {};
  for (const input of document.querySelectorAll('[data-hotkey-action]')) hotkeys[input.dataset.hotkeyAction] = input.value;
  return {
    llmEnabled: document.querySelector('#ai-enabled').checked,
    aiInitialContextEnabled: document.querySelector('#ai-initial-context-enabled').checked,
    aiContinuousContextEnabled: document.querySelector('#ai-continuous-context-enabled').checked,
    aiContextIntervalMinutes: Number(document.querySelector('#ai-context-interval-minutes').value),
    apiKey: document.querySelector('#api-key').value,
    clearApiKey: clearApiKeyRequested,
    apiUrl: document.querySelector('#ai-api-url').value,
    model: document.querySelector('#ai-model').value,
    agentEnabled: document.querySelector('#agent-enabled').checked,
    personality: document.querySelector('#agent-personality').value,
    agentInstructions: document.querySelector('#agent-instructions').value,
    githubCodexActorLogins: document.querySelector('#github-codex-actors').value.split(',').map((item) => item.trim()).filter(Boolean),
    wakeWord: document.querySelector('#voice-wake-word').value,
    sttModel: document.querySelector('#stt-model').value,
    sttProvider: document.querySelector('#stt-provider').value,
    sttCredential: document.querySelector('#stt-credential').value,
    clearSttCredential: clearSttCredentialRequested,
    sttEndpoint: document.querySelector('#stt-endpoint').value,
    sttRegion: document.querySelector('#stt-region').value,
    ttsModel: document.querySelector('#tts-model').value,
    ttsVoice: document.querySelector('#tts-voice').value,
    ttsSpeed: Number(document.querySelector('#tts-speed').value),
    sidebarWidth: Number(document.querySelector('#sidebar-width').value),
    hotkeys
  };
}

function providerDraftConfigured() {
  return Boolean(
    document.querySelector('#ai-api-url').value.trim()
    && document.querySelector('#ai-model').value.trim()
  );
}

function providerDraftPayload() {
  return {
    apiKey: document.querySelector('#api-key').value,
    clearApiKey: clearApiKeyRequested,
    apiUrl: document.querySelector('#ai-api-url').value.trim(),
    model: document.querySelector('#ai-model').value.trim()
  };
}

function providerDraftFingerprint() {
  return JSON.stringify(providerDraftPayload());
}

function providerDraftMatchesSavedSettings() {
  const draft = providerDraftPayload();
  return !draft.apiKey
    && !draft.clearApiKey
    && draft.apiUrl === String(settings.apiUrl || '').trim()
    && draft.model === String(settings.model || '').trim();
}

function setProviderStatus(message = '', isError = false) {
  const status = document.querySelector('#ai-test-status');
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.classList.toggle('success', !isError && message.startsWith('Connected ·'));
}

function syncProviderFeatureAvailability() {
  const configured = providerDraftConfigured();
  for (const id of ['#api-key', '#clear-api-key', '#ai-api-url', '#ai-model']) {
    document.querySelector(id).disabled = providerValidationInFlight;
  }
  document.querySelector('#test-ai').disabled = providerValidationInFlight;
  for (const id of ['#ai-enabled', '#agent-enabled']) {
    const input = document.querySelector(id);
    input.disabled = !configured || providerValidationInFlight;
    input.closest('.toggle-row').title = configured
      ? ''
      : 'Set up the LLM Provider API URL and model first.';
  }
  const aiContextAvailable = configured && !providerValidationInFlight && document.querySelector('#ai-enabled').checked;
  document.querySelector('#ai-initial-context-enabled').disabled = !aiContextAvailable;
  document.querySelector('#ai-continuous-context-enabled').disabled = !aiContextAvailable;
  document.querySelector('#ai-context-interval-minutes').disabled = !aiContextAvailable
    || !document.querySelector('#ai-continuous-context-enabled').checked;
}

function invalidateProviderFeatures() {
  document.querySelector('#ai-enabled').checked = false;
  document.querySelector('#agent-enabled').checked = false;
  setProviderStatus(providerDraftConfigured()
    ? 'Provider changed · enable a feature to verify the connection.'
    : 'Set up the LLM Provider before enabling AI features.', !providerDraftConfigured());
  syncProviderFeatureAvailability();
}

async function persistDisabledProviderFeatures() {
  document.querySelector('#ai-enabled').checked = false;
  document.querySelector('#agent-enabled').checked = false;
  settings = await api.saveSettings({ llmEnabled: false, agentEnabled: false });
  applySettings();
}

async function handleProviderFeatureToggle(input, featureName, settingKey) {
  if (!input.checked) {
    try {
      settings = await api.saveSettings({ [settingKey]: false });
      applySettings();
    } catch (error) {
      input.checked = true;
      setProviderStatus(error.message, true);
    }
    syncProviderFeatureAvailability();
    return;
  }
  if (!providerDraftConfigured()) {
    input.checked = false;
    setProviderStatus('Set up the LLM Provider API URL and model before enabling this feature.', true);
    syncProviderFeatureAvailability();
    return;
  }

  // Persist the provider while the requested feature remains off. It is only
  // enabled after a successful live request to that exact saved configuration.
  const otherSettingKey = settingKey === 'llmEnabled' ? 'agentEnabled' : 'llmEnabled';
  const retainedOtherFeature = providerDraftMatchesSavedSettings() && Boolean(settings[otherSettingKey]);
  const validationFeatureState = {
    [settingKey]: false,
    [otherSettingKey]: retainedOtherFeature
  };
  input.checked = false;
  const providerFingerprint = providerDraftFingerprint();
  providerValidationInFlight = true;
  syncProviderFeatureAvailability();
  setProviderStatus(`Checking the LLM Provider before enabling ${featureName}…`);
  try {
    settings = await api.saveSettings({
      ...providerDraftPayload(),
      ...validationFeatureState
    });
    applySettings();
    const result = await api.testAiSettings();
    if (providerDraftFingerprint() !== providerFingerprint) {
      throw new Error('The provider changed during validation. Enable the feature again to test the current settings.');
    }
    input.checked = true;
    settings = await api.saveSettings({ [settingKey]: true });
    document.querySelector('#api-key').value = '';
    clearApiKeyRequested = false;
    document.querySelector('#api-key').placeholder = settings.hasApiKey ? 'Encrypted key configured' : 'Provider key';
    document.querySelector('#api-key-state').textContent = settings.hasApiKey ? 'Encrypted key configured' : 'No key configured';
    document.querySelector('#clear-api-key').hidden = !settings.hasApiKey;
    applySettings();
    setProviderStatus(`Connected · ${result.name}: ${result.summary}`);
  } catch (error) {
    try {
      settings = await api.saveSettings(validationFeatureState);
      document.querySelector('#ai-enabled').checked = settings.llmEnabled;
      document.querySelector('#agent-enabled').checked = settings.agentEnabled;
      applySettings();
      setProviderStatus(`Set up the LLM Provider: ${error.message}`, true);
    } catch (rollbackError) {
      setProviderStatus(`Provider validation failed and the previous feature state could not be restored: ${rollbackError.message}`, true);
    }
  } finally {
    providerValidationInFlight = false;
    syncProviderFeatureAvailability();
  }
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
  const scan = scanTerminalUrls(session.linkScanBuffer, text);
  session.linkScanBuffer = scan.buffer;
  let changed = false;
  for (const url of scan.urls) {
    if (session.links.some((link) => link.url === url)) continue;
    session.links.push({ url, seenAt: Date.now() });
    changed = true;
  }
  if (session.links.length > 100) session.links.splice(0, session.links.length - 100);
  return changed;
}

function appendSessionContext(session, text) {
  const terminalText = plainTerminalText(text);
  if (captureLinks(session, terminalText)) updateSessionItem(session);
  const plain = terminalText.trim();
  if (!plain) return;
  session.context = `${session.context}\n${plain}`.slice(-MAX_CONTEXT_CHARS);
  session.contextRevision += 1;
  if (shouldRearmAiSummary(session.aiSummaryFailureCount, session.aiSummaryFailureRevision, session.contextRevision)) {
    scheduleAiSummary(session);
  }
  const agent = detectedAgent(plain);
  if (agent) session.agent = agent;
}

function trackTerminalInput(session, data) {
  const input = stripTerminalControlInput(data);
  if (input) {
    session.busySuppressedUntil = 0;
    session.expectedInputEcho = `${session.expectedInputEcho}${input}`.slice(-4096);
    session.expectedInputEchoAt = Date.now();
  }
  for (const character of input) {
    if (character === '\r' || character === '\n') {
      const command = session.commandBuffer.trim();
      if (command) {
        if (/(?:^|\s)git\s+push(?:\s|$)/i.test(command)) {
          api.armGithubPush(session.id, { cwd: session.cwd, links: session.links.map((link) => link.url) });
        }
        const agent = detectedAgent(command);
        if (agent) session.agent = agent;
        appendSessionContext(session, `$ ${command}`);
        if (!isBareAgentLaunchCommand(command)) {
          session.hasUserActivity = true;
          session.activityArmed = true;
          session.activityCycleId = crypto.randomUUID();
          session.activityScanBuffer = '';
          session.lastWorkingAt = 0;
          session.notifyWhenIdle = false;
          scheduleAiSummary(session);
          schedulePersist();
        }
      }
      session.commandBuffer = '';
    } else if (character === '\x7f') {
      session.commandBuffer = session.commandBuffer.slice(0, -1);
    } else if (character >= ' ' && character !== '\x1b') {
      session.commandBuffer += character;
    }
  }
}

function aiContextIntervalMs() {
  return Math.max(1, Math.min(1440, Number(settings.aiContextIntervalMinutes) || 30)) * 60_000;
}

function clearAiSummaryTimer(session) {
  window.clearTimeout(session.aiSummaryTimer);
  session.aiSummaryTimer = null;
  session.aiSummaryMode = '';
  session.aiSummaryDueAt = 0;
}

function armAiSummaryTimer(session, mode, delayMs) {
  if (session.aiSummaryTimer && session.aiSummaryMode === mode) return;
  clearAiSummaryTimer(session);
  session.aiSummaryMode = mode;
  session.aiSummaryDueAt = Date.now() + delayMs;
  session.aiSummaryTimer = window.setTimeout(() => {
    session.aiSummaryTimer = null;
    session.aiSummaryMode = '';
    session.aiSummaryDueAt = 0;
    void requestAiSummary(session, mode);
  }, delayMs);
}

function scheduleAiSummary(session) {
  if (sessions.get(session.id) !== session || !settings.llmEnabled || !settings.apiUrl || !settings.model || session.exited || !session.hasUserActivity) return;
  if (session.aiSummaryFailureCount >= MAX_AI_SUMMARY_FAILURES) {
    if (session.aiSummaryFailureRevision === session.contextRevision) return;
    session.aiSummaryFailureCount = 0;
    session.aiSummaryFailureRevision = 0;
  }
  if (!session.aiInitialSummaryDone) {
    if (settings.aiInitialContextEnabled) {
      armAiSummaryTimer(session, 'initial', AI_INITIAL_CONTEXT_DELAY_MS);
      return;
    }
    session.aiInitialSummaryDone = true;
  }
  if (settings.aiContinuousContextEnabled) {
    const elapsed = session.lastAiSummaryAt ? Date.now() - session.lastAiSummaryAt : 0;
    armAiSummaryTimer(session, 'continuous', Math.max(1_000, aiContextIntervalMs() - elapsed));
  }
}

function syncAiContextSchedules() {
  for (const session of sessions.values()) {
    session.aiSummaryFailureCount = 0;
    session.aiSummaryFailureRevision = 0;
    const preserveInitialDeadline = session.aiSummaryTimer
      && session.aiSummaryMode === 'initial'
      && settings.llmEnabled
      && settings.apiUrl
      && settings.model
      && settings.aiInitialContextEnabled
      && !session.exited;
    if (preserveInitialDeadline) continue;
    clearAiSummaryTimer(session);
    scheduleAiSummary(session);
  }
}

function aiSummaryModeEnabled(mode) {
  return Boolean(
    settings.llmEnabled
    && settings.apiUrl
    && settings.model
    && (mode === 'initial' ? settings.aiInitialContextEnabled : settings.aiContinuousContextEnabled)
  );
}

async function requestAiSummary(session, mode) {
  if (Date.now() < aiSummaryCooldownUntil) {
    armAiSummaryTimer(session, mode, Math.max(1_000, aiSummaryCooldownUntil - Date.now()));
    return;
  }
  if (aiSummaryGlobalInFlight) {
    armAiSummaryTimer(session, mode, AI_SUMMARY_RETRY_DELAY_MS);
    return;
  }
  if (session.aiSummaryInFlight) {
    armAiSummaryTimer(session, mode, 1_000);
    return;
  }
  if (sessions.get(session.id) !== session || !settings.llmEnabled || session.exited) return;
  if (mode === 'initial' && !settings.aiInitialContextEnabled) {
    session.aiInitialSummaryDone = true;
    scheduleAiSummary(session);
    return;
  }
  if (mode === 'continuous' && !settings.aiContinuousContextEnabled) return;
  if (session.contextRevision === session.lastSummarizedRevision) {
    if (mode === 'initial') session.aiInitialSummaryDone = true;
    session.lastAiSummaryAt = Date.now();
    scheduleAiSummary(session);
    return;
  }
  session.aiSummaryInFlight = true;
  aiSummaryGlobalInFlight = true;
  const summarizedContext = session.context;
  const summarizedRevision = session.contextRevision;
  let completed = false;
  let requestFailed = false;
  try {
    const result = await api.summarizeSession({
      context: summarizedContext,
      agent: session.agent || 'Terminal',
      requestTimeoutMs: AI_SUMMARY_REQUEST_TIMEOUT_MS
    });
    if (sessions.get(session.id) !== session || session.exited || !aiSummaryModeEnabled(mode)) return;
    if (!result) {
      requestFailed = true;
      session.aiSummaryFailureCount += 1;
      session.aiSummaryFailureRevision = summarizedRevision;
      return;
    }
    session.displayName = result.name;
    session.summary = result.summary;
    session.lastSummarizedRevision = summarizedRevision;
    session.aiErrorShown = false;
    session.aiSummaryFailureCount = 0;
    session.aiSummaryFailureRevision = 0;
    completed = true;
    aiSummaryCooldownUntil = 0;
    updateSessionItem(session);
    resortSessionGroupByName(session);
    schedulePersist();
  } catch (error) {
    requestFailed = true;
    session.aiSummaryFailureCount += 1;
    session.aiSummaryFailureRevision = summarizedRevision;
    aiSummaryCooldownUntil = Date.now() + AI_SUMMARY_FAILURE_COOLDOWN_MS;
    if (!session.aiErrorShown) {
      session.aiErrorShown = true;
      showToast(`AI naming: ${error.message}`);
    }
  } finally {
    session.aiSummaryInFlight = false;
    aiSummaryGlobalInFlight = false;
    if (sessions.get(session.id) !== session || session.exited) return;
    if (!aiSummaryModeEnabled(mode)) return;
    if (!completed) {
      const retryDelay = aiSummaryRetryDelay(session.aiSummaryFailureCount, {
        baseDelayMs: AI_SUMMARY_RETRY_DELAY_MS,
        cooldownDelayMs: aiSummaryCooldownUntil - Date.now()
      });
      if (!requestFailed || retryDelay !== null) {
        armAiSummaryTimer(session, mode, retryDelay ?? AI_SUMMARY_RETRY_DELAY_MS);
      }
      return;
    }
    if (mode === 'initial') session.aiInitialSummaryDone = true;
    session.lastAiSummaryAt = Date.now();
    scheduleAiSummary(session);
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
  heading.innerHTML = `<strong>GitHub pull requests</strong><span>${session.links.length} captured</span>`;
  linkPopover.append(heading);
  const list = document.createElement('div');
  list.className = 'link-popover-list';
  for (const link of session.links) {
    const button = document.createElement('button');
    button.type = 'button';
    const parsed = new URL(link.url);
    button.innerHTML = `<strong></strong><span></span><time></time>`;
    button.querySelector('strong').textContent = 'GitHub pull request';
    button.querySelector('span').textContent = parsed.pathname;
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
        manualTitle: session.manualTitle,
        shell: session.shell,
        cwd: session.cwd,
        history: terminalHistory(session.terminal),
        notified: session.notified,
        attentionCycleId: session.attentionCycleId,
        activityArmed: session.activityArmed,
        displayName: session.displayName,
        summary: session.summary,
        agent: session.agent,
        hasUserActivity: session.hasUserActivity,
        aiInitialSummaryDone: session.aiInitialSummaryDone,
        lastAiSummaryAt: session.lastAiSummaryAt,
        createdAt: session.createdAt,
        lastResponseAt: session.lastResponseAt,
        links: session.links
      });
    }
  }

  const savedGroups = groups.map((group) => ({
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    sortBy: group.sortBy,
    sortDirection: group.sortDirection,
    sessionIds: group.sessionIds.filter((id) => sessions.has(id))
  }));
  const mobileGroups = groups.map((group) => ({
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    sessionIds: sortedSessionIds(group, sessions)
  }));
  const serializedWorkspace = JSON.stringify({
    version: WORKSPACE_VERSION,
    savedAt: Date.now(),
    groups: savedGroups,
    sessions: savedSessions,
    activeId,
    activeGroupId
  });
  let localStorageSaved = false;
  try {
    localStorage.setItem(WORKSPACE_KEY, serializedWorkspace);
    localStorageSaved = true;
  } catch {
    // The main-process file backup remains available when Chromium storage is full.
  }
  void api.saveWorkspace(serializedWorkspace).catch(() => {
    if (!localStorageSaved) showToast('Workspace could not be saved to browser storage or the file backup');
  });
  api.updateMobileWorkspace({
    groups: mobileGroups,
    sessions: savedSessions.map((session) => ({
      id: session.id,
      groupId: session.groupId,
      title: session.title,
      subtitle: session.exited ? `${session.shell} · stopped` : `${session.shell} · ${session.cwd}`,
      cwd: session.cwd,
      links: session.links.map((link) => link.url),
      summary: session.summary,
      agent: session.agent,
      attentionCycleId: session.attentionCycleId,
      notified: session.notified,
      busy: sessions.get(session.id)?.busy
    }))
  });
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

function closeMobilePanel() {
  mobileBackdrop.classList.remove('visible');
  window.setTimeout(() => { mobileBackdrop.hidden = true; }, 140);
}

function renderMobileInfo(info) {
  const status = document.querySelector('#mobile-status');
  const dot = document.querySelector('#mobile-status-dot');
  const toggle = document.querySelector('#mobile-toggle');
  const urls = document.querySelector('#mobile-urls');
  status.textContent = info.enabled ? `Available on port ${info.port} · starts with SideTerm` : 'Mobile access is disabled';
  dot.classList.toggle('online', info.enabled);
  toggle.textContent = info.enabled ? 'Disable' : 'Enable';
  toggle.classList.toggle('danger-button', info.enabled);
  urls.replaceChildren();
  if (!info.enabled) {
    const hint = document.createElement('span');
    hint.className = 'mobile-url-empty';
    hint.textContent = 'Enable access to generate private connection URLs.';
    urls.append(hint);
    return;
  }
  for (const address of info.urls) {
    const card = document.createElement('section');
    card.className = 'mobile-url-card';
    const row = document.createElement('div');
    row.className = 'mobile-url-row';
    const actions = document.createElement('div');
    actions.className = 'mobile-url-actions';
    const qr = document.createElement('button');
    qr.type = 'button';
    qr.className = 'secondary-button';
    qr.textContent = 'QR code ▾';
    qr.setAttribute('aria-expanded', 'false');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'secondary-button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await api.writeClipboard(address.url);
      copy.textContent = 'Copied';
      window.setTimeout(() => { copy.textContent = 'Copy'; }, 1_200);
    });
    const text = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = address.label;
    const url = document.createElement('code');
    url.textContent = address.url;
    text.append(label, url);
    actions.append(qr, copy);
    row.append(text, actions);
    const qrPanel = document.createElement('div');
    qrPanel.className = 'mobile-url-qr';
    qrPanel.hidden = true;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `QR code for ${address.label}`);
    const qrCopy = document.createElement('div');
    const qrHeading = document.createElement('strong');
    qrHeading.textContent = `Scan ${address.label}`;
    const qrUrl = document.createElement('code');
    qrUrl.textContent = address.url;
    qrCopy.append(qrHeading, qrUrl);
    qrPanel.append(canvas, qrCopy);
    let generated = false;
    qr.addEventListener('click', async () => {
      const opening = qrPanel.hidden;
      qrPanel.hidden = !opening;
      qr.setAttribute('aria-expanded', String(opening));
      qr.textContent = opening ? 'QR code ▴' : 'QR code ▾';
      if (!opening || generated) return;
      try {
        await QRCode.toCanvas(canvas, address.url, {
          width: 196,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#101010', light: '#ffffff' }
        });
        generated = true;
      } catch (error) {
        qrPanel.hidden = true;
        qr.setAttribute('aria-expanded', 'false');
        showToast(`Could not generate QR code: ${error.message}`);
      }
    });
    card.append(row, qrPanel);
    urls.append(card);
  }
}

async function openMobilePanel() {
  mobileBackdrop.hidden = false;
  requestAnimationFrame(() => mobileBackdrop.classList.add('visible'));
  try {
    renderMobileInfo(await api.getMobileInfo());
    const tailscale = await api.getTailscaleHttpsStatus();
    document.querySelector('#tailscale-https-status').textContent = tailscale.enabled
      ? `Ready at ${tailscale.url}`
      : tailscale.available ? 'Required for phone microphone access' : 'Tailscale is not installed';
    document.querySelector('#enable-tailscale-https').hidden = tailscale.enabled || !tailscale.available;
  } catch (error) {
    document.querySelector('#mobile-status').textContent = error.message;
  }
}

function updateAgentBadge() {
  const unread = (agentState.notifications || []).filter((item) => !item.read).length;
  const badge = document.querySelector('.agent-unread-badge');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
}

const spokenProactiveMessageIds = new Set();
let proactiveMessagesSynced = false;

function handleProactiveMessages() {
  const proactiveMessages = (agentState.messages || []).filter((message) => message.role === 'assistant' && message.proactive);
  if (!proactiveMessagesSynced) {
    proactiveMessagesSynced = true;
    for (const message of proactiveMessages) spokenProactiveMessageIds.add(message.id);
    return;
  }
  for (const message of proactiveMessages) {
    if (spokenProactiveMessageIds.has(message.id)) continue;
    spokenProactiveMessageIds.add(message.id);
    const brief = message.voiceSummary || message.text;
    if (desktopVoiceMode && !message.desktopSpeechPresented) void queueAgentSpeech(brief);
    else if (!supervisorDashboardActive) showToast(`Supervisor: ${brief.slice(0, 180)}`);
  }
}

function renderAgentState(nextState) {
  agentState = { ...agentState, ...(nextState || {}) };
  handleProactiveMessages();
  updateAgentBadge();
  const dot = document.querySelector('#agent-status-dot');
  const label = document.querySelector('#agent-status-label');
  const detail = document.querySelector('#agent-status-detail');
  dot.className = agentState.status === 'thinking' ? 'thinking' : agentState.status === 'error' ? 'error' : '';
  label.textContent = !agentState.enabled ? 'Supervisor disabled' : agentState.status === 'thinking' ? 'Thinking…' : agentState.status === 'error' ? 'Needs attention' : 'Ready';
  detail.textContent = !agentState.enabled ? 'Enable it in Settings to start tracking sessions' : agentState.configured ? 'Watching all SideTerm sessions' : 'Configure an API URL and model';

  const metrics = agentState.metrics || {};
  document.querySelector('#agent-metric-pending').textContent = String(metrics.pendingSessions || 0);
  document.querySelector('#agent-metric-running').textContent = String(metrics.runningSessions || 0);
  document.querySelector('#agent-metric-inputs').textContent = Number(metrics.terminalInputsApproved || 0).toLocaleString();
  document.querySelector('#agent-metric-words').textContent = Number(metrics.terminalWordsEntered || 0).toLocaleString();
  const pendingSessions = document.querySelector('#agent-pending-sessions');
  pendingSessions.replaceChildren();
  if (!(agentState.pendingSessions || []).length) {
    const empty = document.createElement('span');
    empty.className = 'agent-chat-empty';
    empty.textContent = 'Nothing pending. All sessions are idle and acknowledged.';
    pendingSessions.append(empty);
  }
  for (const session of agentState.pendingSessions || []) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'agent-pending-session';
    const stateLabel = session.busy ? 'Running' : 'Needs attention';
    card.innerHTML = '<span class="agent-pending-state"></span><span class="agent-pending-copy"><strong></strong><small></small></span><span class="agent-pending-arrow">›</span>';
    card.classList.toggle('running', Boolean(session.busy));
    card.querySelector('.agent-pending-state').textContent = stateLabel;
    card.querySelector('strong').textContent = session.title || 'Terminal';
    card.querySelector('small').textContent = session.subtitle || session.group || '';
    card.addEventListener('click', () => activateSession(session.id));
    pendingSessions.append(card);
  }

  const pullRequests = document.querySelector('#agent-pull-requests');
  pullRequests.replaceChildren();
  if (!(agentState.pullRequests || []).length) {
    const empty = document.createElement('span');
    empty.className = 'agent-chat-empty';
    empty.textContent = 'No pull requests monitored yet. SideTerm starts after a successful commit or push.';
    pullRequests.append(empty);
  }
  for (const pull of [...(agentState.pullRequests || [])].reverse()) {
    const card = document.createElement('article');
    card.className = 'agent-pull-card';
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'agent-pull-heading';
    const title = document.createElement('strong');
    title.textContent = pull.title || pull.url;
    const status = document.createElement('span');
    status.textContent = `${pull.state || 'open'} · ${pull.comments?.length || 0} comments`;
    heading.append(title, status);
    heading.addEventListener('click', () => void api.openExternal(pull.url));
    const body = document.createElement('p');
    body.textContent = pull.body || 'No pull request description.';
    const reactions = document.createElement('div');
    reactions.className = 'agent-pull-reactions';
    for (const reaction of pull.reactions || []) {
      const chip = document.createElement('span');
      chip.textContent = `${reaction.emoji} ${reaction.count}`;
      reactions.append(chip);
    }
    const latest = document.createElement('div');
    latest.className = 'agent-pull-comments';
    for (const comment of (pull.comments || []).slice(-3).reverse()) {
      const row = document.createElement('span');
      row.textContent = `${comment.author}: ${comment.body || comment.state}`;
      latest.append(row);
    }
    card.append(heading, body, reactions, latest);
    pullRequests.append(card);
  }

  const unread = (agentState.notifications || []).filter((item) => !item.read);
  document.querySelector('#agent-notification-count').textContent = String(unread.length);
  const notifications = document.querySelector('#agent-notifications');
  notifications.replaceChildren();
  const visibleNotifications = (agentState.notifications || []).slice(-10).reverse();
  if (!visibleNotifications.length) {
    const empty = document.createElement('span');
    empty.className = 'agent-chat-empty';
    empty.textContent = 'No completed-session updates yet.';
    notifications.append(empty);
  }
  for (const item of visibleNotifications) {
    const card = document.createElement('article');
    card.className = 'agent-notification';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const summary = document.createElement('span');
    summary.textContent = item.summary || (item.read ? 'Update delivered' : 'Finished · awaiting summary');
    card.append(title, summary);
    notifications.append(card);
  }

  const chat = document.querySelector('#agent-chat');
  chat.replaceChildren();
  if (!(agentState.messages || []).length) {
    const empty = document.createElement('div');
    empty.className = 'agent-chat-empty';
    empty.textContent = agentState.enabled ? 'Ask for a status update or tell me what to work on next.' : 'The supervisor dashboard will appear here when enabled.';
    chat.append(empty);
  }
  for (const message of agentState.messages || []) {
    const bubble = document.createElement('div');
    bubble.className = `agent-message ${message.role}`;
    if (message.role === 'assistant') {
      renderMarkdown(document, bubble, message.text, { onLink: (url) => void api.openExternal(url) });
    } else {
      bubble.textContent = message.text;
    }
    chat.append(bubble);
  }
  chat.scrollTop = chat.scrollHeight;

  const confirmations = document.querySelector('#agent-confirmations');
  confirmations.replaceChildren();
  for (const confirmation of agentState.confirmations || []) {
    const row = document.createElement('div');
    row.className = 'agent-confirmation';
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = confirmation.kind === 'archive'
      ? `Archive ${confirmation.title}?`
      : confirmation.kind === 'github-comment'
        ? `Post comment to ${confirmation.pullRequestUrl}?`
        : `Send input to ${confirmation.title}?`;
    const detailText = document.createElement('code');
    detailText.textContent = confirmation.kind === 'archive'
      ? confirmation.summary
      : confirmation.kind === 'github-comment'
        ? confirmation.body
        : confirmation.input;
    copy.append(heading, detailText);
    if (confirmation.kind === 'github-comment') row.classList.add('github-comment');
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.className = 'secondary-button';
    deny.textContent = 'Deny';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'secondary-button approve';
    approve.textContent = 'Approve';
    deny.addEventListener('click', () => void respondToAgentConfirmation(confirmation.id, false));
    approve.addEventListener('click', () => void respondToAgentConfirmation(confirmation.id, true));
    row.append(copy, deny, approve);
    confirmations.append(row);
  }
  if (supervisorDashboardActive && agentState.enabled && agentState.status !== 'thinking' && unread.length && !agentCatchUpInFlight) {
    void runAgentCatchUpQueue();
  }
}

async function respondToAgentConfirmation(id, approved) {
  try {
    renderAgentState(await api.confirmAgentAction(id, approved));
  } catch (error) {
    showToast(error.message);
  }
}

async function openAgentPanel() {
  const foreground = sessions.get(activeId);
  if (foreground?.busy && foreground.activityArmed) foreground.notifyWhenIdle = true;
  supervisorDashboardActive = true;
  shellElement.classList.add('supervisor-active');
  supervisorDashboard.hidden = false;
  document.querySelector('#agent-button').classList.add('active');
  try {
    renderAgentState(await api.getAgentState());
    await runAgentCatchUpQueue();
  } catch (error) {
    if (!String(error?.message || '').includes('already working')) showToast(`Supervisor: ${error.message}`);
  }
}

async function runAgentCatchUpQueue() {
  if (agentCatchUpInFlight || !agentState.enabled || !agentState.notifications.some((item) => !item.read)) return;
  agentCatchUpInFlight = true;
  try {
    while (supervisorDashboardActive) {
      const result = await api.catchUpAgent({ voice: desktopVoiceMode });
      renderAgentState(result.state);
      if (!result.response) {
        if (result.hasMore) continue;
        break;
      }
      const speechCompleted = await queueAgentSpeech(result.speech || result.response);
      if (!speechCompleted) break;
      if (!result.hasMore && !agentState.notifications.some((item) => !item.read)) break;
    }
  } finally {
    agentCatchUpInFlight = false;
  }
}

function closeAgentPanel() {
  const foreground = sessions.get(activeId);
  if (foreground) foreground.notifyWhenIdle = false;
  supervisorDashboardActive = false;
  shellElement.classList.remove('supervisor-active');
  supervisorDashboard.hidden = true;
  document.querySelector('#agent-button').classList.remove('active');
  requestAnimationFrame(() => {
    fitActive();
    sessions.get(activeId)?.terminal.focus();
  });
}

async function submitAgentChat(text, { spokenRequest = false, interactionId = '' } = {}) {
  const input = document.querySelector('#agent-chat-input');
  const prompt = String(text ?? input.value).trim();
  if (!prompt) return;
  input.value = '';
  try {
    const result = await api.chatWithAgent(prompt, { voice: desktopVoiceMode, spokenRequest, interactionId });
    renderAgentState(result.state);
    await queueAgentSpeech(result.speech || result.response);
  } catch (error) {
    showToast(`Supervisor: ${error.message}`);
    renderAgentState(await api.getAgentState().catch(() => agentState));
  }
}

async function handleAgentAction({ requestId, type, payload }) {
  try {
    if (type === 'create-session') {
      let group = payload.createGroup
        ? null
        : payload.groupId
          ? groups.find((item) => item.id === payload.groupId)
          : payload.groupName
        ? groups.find((item) => item.title.toLowerCase() === String(payload.groupName).toLowerCase())
        : getGroup(activeGroupId);
      if (!group) {
        group = createGroup(makeGroupId(), String(payload.groupName || `Group ${groups.length + 1}`).slice(0, 32));
        groups.push(group);
        renderGroups();
      }
      const requestedName = String(payload.name || '').trim();
      const session = await addSession(payload.cwd, {
        groupId: group.id,
        title: requestedName ? requestedName.slice(0, 64) : `Terminal ${sessions.size + 1}`,
        manualTitle: Boolean(requestedName)
      });
      api.resolveAgentAction(requestId, { id: session.id, title: session.title, group: group.title, cwd: session.cwd });
      return;
    }
    if (type === 'archive-session') {
      const session = sessions.get(payload.sessionId);
      if (!session) throw new Error('The session is no longer available.');
      const group = getGroupForSession(session.id);
      const result = { id: session.id, title: session.title, group: group?.title || '' };
      closeSession(session.id);
      api.resolveAgentAction(requestId, result);
      return;
    }
    throw new Error(`Unknown supervisor action: ${type}`);
  } catch (error) {
    api.resolveAgentAction(requestId, null, error.message);
  }
}

function reportSessionCompletion(session) {
  if (!session?.activityCycleId || session.lastReportedCycleId === session.activityCycleId) return;
  session.lastReportedCycleId = session.activityCycleId;
  api.reportSessionFinished({
    cycleId: session.activityCycleId,
    sessionId: session.id,
    title: session.title,
    summary: session.summary,
    context: session.context || terminalHistory(session.terminal),
    cwd: session.cwd,
    links: session.links,
    foreground: isSessionForeground(session)
  });
}

function renderSpeechStatus(status) {
  const stt = document.querySelector('#stt-status');
  const tts = document.querySelector('#tts-status');
  if (stt) {
    stt.textContent = status.sttLocation === 'cloud'
      ? status.sttInstalled ? `Configured · CLOUD — ${status.sttProviderName}` : `Needs setup · CLOUD — ${status.sttProviderName}`
      : status.sttInstalled ? 'Installed · LOCAL — Parakeet' : 'Not installed · LOCAL — Parakeet';
    stt.classList.remove('install-error');
    stt.removeAttribute('title');
  }
  if (tts) {
    tts.textContent = status.ttsInstalled ? 'Installed' : 'Not installed';
    tts.classList.remove('install-error');
    tts.removeAttribute('title');
  }
  const installStt = document.querySelector('#install-stt');
  const installTts = document.querySelector('#install-tts');
  if (installStt) installStt.textContent = status.sttInstalled ? 'Reinstall' : 'Install';
  if (installTts) installTts.textContent = status.ttsInstalled ? 'Reinstall' : 'Install';
}

async function refreshSpeechStatus() {
  try {
    const status = await api.getSpeechStatus();
    renderSpeechStatus(status);
    return status;
  } catch (error) {
    document.querySelector('#stt-status').textContent = error.message;
    document.querySelector('#tts-status').textContent = error.message;
    return { sttInstalled: false, ttsInstalled: false };
  }
}

async function installSpeech(kind) {
  const button = document.querySelector(kind === 'stt' ? '#install-stt' : '#install-tts');
  const status = document.querySelector(kind === 'stt' ? '#stt-status' : '#tts-status');
  button.disabled = true;
  status.classList.remove('install-error');
  status.removeAttribute('title');
  status.textContent = 'Installing…';
  try {
    if (!await saveSettingsFromPanel({ close: false })) throw new Error('Could not save the speech settings.');
    renderSpeechStatus(await api.installSpeech(kind));
    showToast(`${kind === 'stt' ? 'Speech to text' : 'Pocket TTS'} installed`);
  } catch (error) {
    const message = String(error?.message || error || 'Unknown installer error.');
    status.textContent = `Install failed: ${message}`;
    status.classList.add('install-error');
    status.title = message;
    showToast(message);
  } finally {
    button.disabled = false;
  }
}

async function playSpeechAudio(audio) {
  if (!audio?.data) throw new Error('The speech runtime returned no audio.');
  voiceCaptureMuted = true;
  await api.pauseDesktopMedia().catch(() => {});
  try {
    const player = new Audio(`data:${audio.mimeType || 'audio/wav'};base64,${audio.data}`);
    activeVoicePlayer = player;
    voiceBargeInStartedAt = 0;
    player.playbackRate = Math.max(0.75, Math.min(1.5, Number(audio.playbackRate) || 1));
    await player.play();
    return await new Promise((resolve, reject) => {
      player.addEventListener('ended', () => resolve(true), { once: true });
      player.addEventListener('sideterm-interrupted', () => resolve(false), { once: true });
      player.addEventListener('error', () => reject(new Error('Could not play the generated voice.')), { once: true });
    });
  } finally {
    activeVoicePlayer = null;
    voiceBargeInStartedAt = 0;
    await api.resumeDesktopMedia().catch(() => {});
    voiceCaptureMuted = false;
  }
}

function interruptVoicePlayback() {
  const player = activeVoicePlayer;
  if (!player) return false;
  activeVoicePlayer = null;
  player.pause();
  player.dispatchEvent(new Event('sideterm-interrupted'));
  voiceCaptureMuted = false;
  return true;
}

async function speakAgentResponse(text, { openReplyWindow = true } = {}) {
  if (!desktopVoiceMode) return true;
  try {
    const completed = await playSpeechAudio(await api.synthesizeSpeech(text));
    if (completed && openReplyWindow) voiceReplyUntil = Date.now() + VOICE_REPLY_WINDOW_MS;
    return completed;
  } catch (error) {
    showToast(`Voice: ${error.message}`);
    return false;
  }
}

function queueAgentSpeech(text, options = {}) {
  const spokenText = String(text || '').trim();
  if (!spokenText) return Promise.resolve(true);
  agentSpeechQueue = agentSpeechQueue
    .catch(() => false)
    .then(() => desktopVoiceMode ? speakAgentResponse(spokenText, options) : true);
  return agentSpeechQueue;
}

async function processVoiceUtterance(blob, durationMs) {
  if (!desktopVoiceMode || voiceCaptureMuted || voiceTranscriptionInFlight || durationMs < 650 || blob.size < 1000) return;
  voiceTranscriptionInFlight = true;
  const label = document.querySelector('#agent-status-detail');
  label.textContent = settings.sttProvider && settings.sttProvider !== 'parakeet'
    ? 'Transcribing with the selected cloud provider…'
    : 'Transcribing locally…';
  try {
    const transcript = await api.transcribeSpeech(
      new Uint8Array(await blob.arrayBuffer()),
      blob.type,
      Date.now() <= voiceReplyUntil
    );
    if (transcript.ignored) {
      label.textContent = transcript.reason || 'Waiting for the wake word';
      return;
    }
    if (transcript.clarification) {
      label.textContent = 'Waiting for clarification';
      voiceReplyInteractionId = transcript.clarification.interactionId || '';
      await queueAgentSpeech(transcript.clarification.prompt, { openReplyWindow: true });
      return;
    }
    voiceReplyUntil = 0;
    const interactionId = voiceReplyInteractionId;
    voiceReplyInteractionId = '';
    document.querySelector('#agent-chat-input').value = transcript.text;
    await submitAgentChat(transcript.text, { spokenRequest: true, interactionId });
  } catch (error) {
    showToast(`Voice: ${error.message}`);
  } finally {
    voiceTranscriptionInFlight = false;
    if (desktopVoiceMode) {
      label.textContent = Date.now() <= voiceReplyUntil
        ? 'Listening for your reply'
        : `Listening for “${settings.wakeWord || 'speech'}”`;
    }
  }
}

async function startDesktopVoiceMode() {
  const status = await refreshSpeechStatus();
  if (!status.sttInstalled || !status.ttsInstalled) throw new Error('Install both local speech models in Settings first.');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording is unavailable in this desktop session.');
  voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  voiceAudioContext = new AudioContext();
  const source = voiceAudioContext.createMediaStreamSource(voiceStream);
  const analyser = voiceAudioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const chunks = [];
  let header = null;
  let preRoll = [];
  let utterance = [];
  let speaking = false;
  let startedAt = 0;
  let silenceAt = 0;
  voiceRecorder = new MediaRecorder(voiceStream);
  voiceRecorder.addEventListener('dataavailable', (event) => {
    if (!event.data.size) return;
    chunks.push(event.data);
    if (!header) {
      header = event.data;
      return;
    }
    if (speaking) utterance.push(event.data);
    else {
      preRoll.push(event.data);
      if (preRoll.length > 5) preRoll.shift();
    }
  });
  voiceRecorder.start(220);
  const monitor = () => {
    if (!desktopVoiceMode || !voiceAudioContext) return;
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    const now = performance.now();
    if (activeVoicePlayer) {
      if (rms > 0.075) {
        voiceBargeInStartedAt ||= now;
        if (now - voiceBargeInStartedAt >= 280) {
          interruptVoicePlayback();
          speaking = true;
          startedAt = now;
          silenceAt = 0;
          utterance = [];
          preRoll = [];
        }
      } else {
        voiceBargeInStartedAt = 0;
      }
    } else if (rms > 0.035) {
      if (!speaking) {
        speaking = true;
        startedAt = now;
        utterance = [...preRoll];
      }
      silenceAt = 0;
    } else if (speaking) {
      silenceAt ||= now;
      if (now - silenceAt > 850 || now - startedAt > 14_000) {
        const duration = now - startedAt;
        const material = header ? [header, ...utterance] : utterance;
        const blob = new Blob(material, { type: voiceRecorder.mimeType || 'audio/webm' });
        speaking = false;
        silenceAt = 0;
        utterance = [];
        preRoll = [];
        void processVoiceUtterance(blob, duration);
      }
    }
    voiceMonitorFrame = requestAnimationFrame(monitor);
  };
  voiceMonitorFrame = requestAnimationFrame(monitor);
  desktopVoiceMode = true;
  api.setAgentVoiceMode(true);
  document.querySelector('#desktop-voice-toggle').textContent = 'Voice on';
  document.querySelector('#desktop-voice-toggle').classList.add('voice-active');
  document.querySelector('#agent-status-detail').textContent = `Listening for “${settings.wakeWord || 'speech'}”`;
}

function stopDesktopVoiceMode() {
  interruptVoicePlayback();
  desktopVoiceMode = false;
  voiceTranscriptionInFlight = false;
  voiceReplyUntil = 0;
  voiceReplyInteractionId = '';
  api.setAgentVoiceMode(false);
  if (voiceMonitorFrame) cancelAnimationFrame(voiceMonitorFrame);
  voiceMonitorFrame = null;
  if (voiceRecorder?.state !== 'inactive') voiceRecorder.stop();
  voiceRecorder = null;
  for (const track of voiceStream?.getTracks() || []) track.stop();
  voiceStream = null;
  void voiceAudioContext?.close();
  voiceAudioContext = null;
  document.querySelector('#desktop-voice-toggle').textContent = 'Voice off';
  document.querySelector('#desktop-voice-toggle').classList.remove('voice-active');
  document.querySelector('#agent-status-detail').textContent = 'Watching all SideTerm sessions';
}

function groupNotificationCount(group) {
  return group.sessionIds.reduce((count, id) => count + (sessions.get(id)?.notified ? 1 : 0), 0);
}

function updateSessionItem(session) {
  if (!session.item) return;
  const labels = sessionDisplayLabels(session, settings.llmEnabled && settings.apiUrl && settings.model);
  const { aiLabelActive, primary } = labels;
  const secondary = labels.secondary || (session.exited
    ? `${session.shell} · stopped`
    : `${session.shell} · ${session.cwd === '~' ? '~' : session.cwd.split('/').filter(Boolean).at(-1) || '/'}`);
  session.sortName = primary;
  session.item.title = (aiLabelActive || session.manualTitle) ? `${primary} ${secondary}` : session.title;
  session.item.querySelector('.session-details strong').textContent = primary;
  session.item.querySelector('.session-details small').textContent = secondary;
  session.item.classList.toggle('has-notification', session.notified);
  session.item.classList.toggle('session-busy', session.busy);
  session.item.classList.toggle('session-exited', session.exited);
  const linkTrigger = session.item.querySelector('.session-link-trigger');
  linkTrigger.hidden = session.links.length === 0;
  linkTrigger.querySelector('span').textContent = String(session.links.length);
  if (session.id === activeId && !activeTitle.isContentEditable) activeTitle.textContent = primary;
}

function resortSessionGroupByName(session) {
  if (getGroupForSession(session.id)?.sortBy === 'name') renderGroups();
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
  let finished = false;
  titleElement.contentEditable = 'true';
  titleElement.classList.add('renaming');
  titleElement.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(titleElement);

  const finish = (commit) => {
    if (finished) return;
    finished = true;
    titleElement.removeEventListener('keydown', onKeyDown);
    titleElement.removeEventListener('blur', onBlur);
    titleElement.contentEditable = 'false';
    titleElement.classList.remove('renaming');
    const next = titleElement.textContent.trim().slice(0, 32);
    group.title = commit && next ? next : original;
    titleElement.textContent = group.title;
    schedulePersist();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleElement.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  titleElement.addEventListener('keydown', onKeyDown);
  titleElement.addEventListener('blur', onBlur);
}

function startSessionRename(session, titleElement) {
  if (!session || titleElement.isContentEditable) return;
  const original = session.title;
  let finished = false;
  titleElement.contentEditable = 'true';
  titleElement.classList.add('renaming');
  titleElement.focus();
  window.getSelection()?.selectAllChildren(titleElement);

  const finish = (commit) => {
    if (finished) return;
    finished = true;
    titleElement.removeEventListener('keydown', onKeyDown);
    titleElement.removeEventListener('blur', onBlur);
    titleElement.contentEditable = 'false';
    titleElement.classList.remove('renaming');
    const next = titleElement.textContent.trim().replace(/\s+/g, ' ').slice(0, 50);
    if (commit && next) {
      session.title = next;
      session.manualTitle = true;
    } else {
      session.title = original;
    }
    titleElement.textContent = session.title;
    updateSessionItem(session);
    resortSessionGroupByName(session);
    schedulePersist();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleElement.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  titleElement.addEventListener('keydown', onKeyDown);
  titleElement.addEventListener('blur', onBlur);
}

function closeGroupSortMenus() {
  for (const menu of sessionList.querySelectorAll('.group-sort-menu')) menu.hidden = true;
  for (const button of sessionList.querySelectorAll('.group-sort')) button.setAttribute('aria-expanded', 'false');
}

function renderGroups() {
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'session-group';
    section.dataset.groupId = group.id;
    section.classList.toggle('group-collapsed', group.collapsed);
    section.style.setProperty('--group-color', group.color);
    section.innerHTML = `
      <header class="group-header" draggable="true">
        <button class="group-toggle" type="button" aria-label="${group.collapsed ? 'Expand' : 'Collapse'} group" title="${group.collapsed ? 'Expand' : 'Collapse'} group">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5"/></svg>
        </button>
        <span class="group-grip" aria-hidden="true">⠿</span>
        <span class="group-avatar" aria-hidden="true"></span>
        <strong class="group-title" title="Click to rename"></strong>
        <input class="group-color" type="color" value="${group.color}" draggable="false" aria-label="Choose group color" title="Choose group color">
        <span class="group-session-count"></span>
        <span class="group-notification-badge" hidden></span>
        <span class="group-sort-wrap">
          <button class="group-sort" type="button" title="Sort sessions" aria-haspopup="menu" aria-expanded="false">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M5 8h8M7 12h6"/></svg>
          </button>
          <span class="group-sort-menu" role="menu" hidden></span>
        </span>
        <button class="group-add" type="button" aria-label="New session in this group" title="New session in this group">+</button>
        <button class="group-delete" type="button" aria-label="Delete group" title="Delete group">×</button>
      </header>
      <div class="group-sessions" role="list"></div>
    `;
    section.querySelector('.group-avatar').textContent = group.title.slice(0, 1).toUpperCase();
    const title = section.querySelector('.group-title');
    title.textContent = group.title;
    title.addEventListener('click', (event) => {
      event.stopPropagation();
      if (title.isContentEditable) return;
      startGroupRename(group, title);
    });
    const colorInput = section.querySelector('.group-color');
    colorInput.setAttribute('aria-label', `Choose color for ${group.title}`);
    colorInput.addEventListener('pointerdown', (event) => event.stopPropagation());
    colorInput.addEventListener('click', (event) => event.stopPropagation());
    colorInput.addEventListener('input', (event) => {
      event.stopPropagation();
      group.color = event.currentTarget.value;
      section.style.setProperty('--group-color', group.color);
      schedulePersist();
    });
    const sortButton = section.querySelector('.group-sort');
    sortButton.setAttribute('aria-label', `Sort sessions in ${group.title}`);
    const sortMenu = section.querySelector('.group-sort-menu');
    for (const option of GROUP_SORT_OPTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'menuitem';
      const active = group.sortBy === option.value;
      button.classList.toggle('active', active);
      button.innerHTML = `<span></span><i aria-hidden="true"></i>`;
      button.querySelector('span').textContent = option.label;
      button.querySelector('i').textContent = active ? (group.sortDirection === 'desc' ? '↓' : '↑') : '';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (group.sortBy === option.value) {
          group.sortDirection = group.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
          group.sortBy = option.value;
          group.sortDirection = option.initialDirection;
        }
        renderGroups();
        schedulePersist();
      });
      sortMenu.append(button);
    }
    sortButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = sortMenu.hidden;
      closeGroupSortMenus();
      sortMenu.hidden = !opening;
      sortButton.setAttribute('aria-expanded', String(opening));
    });
    section.querySelector('.group-toggle').addEventListener('click', (event) => {
      event.stopPropagation();
      group.collapsed = !group.collapsed;
      renderGroups();
      schedulePersist();
    });
    section.querySelector('.group-add').addEventListener('click', (event) => {
      event.stopPropagation();
      const recentSession = [...group.sessionIds].reverse().map((id) => sessions.get(id)).find(Boolean);
      void addSession(recentSession?.cwd, { groupId: group.id });
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
    for (const sessionId of sortedSessionIds(group, sessions)) {
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
      <span class="activity-spinner" aria-label="Session is producing output"></span>
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
  if (supervisorDashboardActive) closeAgentPanel();
  if (activeTitle.isContentEditable) activeTitle.blur();
  const previous = sessions.get(activeId);
  if (previous && previous.id !== id && previous.busy && previous.activityArmed) {
    previous.notifyWhenIdle = true;
  }
  if (previous?.id !== id && !next.busy) {
    next.busySuppressedUntil = Date.now() + ACTIVATION_REDRAW_SUPPRESS_MS;
  }
  activeId = id;
  const group = getGroupForSession(id);
  if (group) {
    activeGroupId = group.id;
    if (group.collapsed) {
      group.collapsed = false;
      renderGroups();
    }
  }
  acknowledgeSessionNotification(next);
  activeTitle.textContent = sessionDisplayLabels(next, settings.llmEnabled && settings.apiUrl && settings.model).primary;
  activeSubtitle.textContent = next.exited
    ? `${next.shell} · stopped · ${next.cwd}`
    : `${next.shell} · ${next.cwd}`;
  statusDot.classList.toggle('stopped', next.exited);
  updateVisualState();
  schedulePersist();
  requestAnimationFrame(() => {
    fitSession(next);
    next.terminal.focus();
    window.setTimeout(() => fitSession(next), 120);
  });
}

function fitSession(session) {
  if (!session || !session.pane.classList.contains('active')) return;
  try {
    session.fit.fit();
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

function isSessionForeground(session) {
  return isForegroundSession({
    sessionId: session?.id,
    activeId,
    dashboardActive: supervisorDashboardActive,
    documentVisible: document.visibilityState === 'visible',
    windowFocused: document.hasFocus()
  });
}

function markSessionNotification(session) {
  if (!session || isSessionForeground(session) || session.notified) return;
  session.notified = true;
  session.attentionCycleId = session.activityCycleId || crypto.randomUUID();
  session.activityArmed = false;
  session.notifyWhenIdle = false;
  updateSessionItem(session);
  updateVisualState();
  schedulePersist();
}

function acknowledgeSessionNotification(session) {
  if (!session) return false;
  session.notifyWhenIdle = false;
  if (!session.notified) return false;
  const cycleId = session.attentionCycleId;
  session.notified = false;
  session.attentionCycleId = '';
  if (!session.busy) session.activityArmed = false;
  updateSessionItem(session);
  updateVisualState();
  schedulePersist();
  if (cycleId) void api.acknowledgeSessionAttention(session.id, cycleId).catch(() => {});
  return true;
}

function acknowledgeActiveSessionOnFocus() {
  const session = sessions.get(activeId);
  if (session && isSessionForeground(session)) acknowledgeSessionNotification(session);
}

function releaseTerminalSelectionDrag() {
  releaseStaleMouseDrag(document);
}

function handleWindowFocus() {
  releaseTerminalSelectionDrag();
  acknowledgeActiveSessionOnFocus();
}

function visibleTerminalText(terminal) {
  const buffer = terminal?.buffer?.active;
  if (!buffer) return '';
  const screenRows = Math.max(1, terminal.rows || 1);
  const { start, end } = terminalStatusRowRange({
    bufferLength: buffer.length,
    baseY: buffer.baseY,
    cursorY: buffer.cursorY,
    screenRows
  });
  const lines = [];
  for (let index = start; index < end; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '');
  }
  return lines.join('\n');
}

function settleSessionBusy(session) {
  if (!session?.busy) return;
  if (shouldKeepSessionBusy(session.activityArmed, visibleTerminalText(session.terminal), {
    lastWorkingAt: session.lastWorkingAt,
    unknownGraceMs: SESSION_BUSY_UNKNOWN_GRACE_MS
  })) {
    session.busyTimer = window.setTimeout(() => settleSessionBusy(session), SESSION_BUSY_SETTLE_MS);
    return;
  }
  session.busy = false;
  session.lastWorkingAt = 0;
  session.activityScanBuffer = '';
  updateSessionItem(session);
  reportSessionCompletion(session);
  if (session.notifyWhenIdle) {
    session.notifyWhenIdle = false;
    if (!isSessionForeground(session)) markSessionNotification(session);
  } else if (isSessionForeground(session)) {
    session.activityArmed = false;
    schedulePersist();
  }
}

function recheckSuppressedAgentBusy(session) {
  session.busyTimer = null;
  if (!session.activityArmed || session.notified || session.exited) return;
  if (!shouldKeepSessionBusy(true, visibleTerminalText(session.terminal), {
    lastWorkingAt: session.lastWorkingAt,
    unknownGraceMs: SESSION_BUSY_UNKNOWN_GRACE_MS
  })) {
    session.activityArmed = false;
    schedulePersist();
    return;
  }
  noteSessionBusy(session, '');
}

function noteSessionBusy(session, data) {
  if (!session || session.exited) return;
  const output = plainTerminalText(data);
  const visible = visibleTerminalText(session.terminal);
  session.activityScanBuffer = `${session.activityScanBuffer}${output}`.slice(-8_000);
  const visibleState = agentActivityState(visible);
  const activityState = visibleState === 'unknown'
    ? agentActivityState(session.activityScanBuffer)
    : visibleState;
  const agentIsWorking = activityState === 'working';
  if (agentIsWorking) session.lastWorkingAt = Date.now();
  if (!output.trim() && !agentIsWorking) return;
  if (canAutoArmAgentActivity(session.activityArmed, session.notified, agentIsWorking)) {
    session.activityArmed = true;
    session.activityCycleId = crypto.randomUUID();
    session.notifyWhenIdle = !isSessionForeground(session);
  }
  if (!session.activityArmed) return;
  if (!session.busy && Date.now() < session.busySuppressedUntil) {
    if (agentIsWorking) {
      window.clearTimeout(session.busyTimer);
      session.busyTimer = window.setTimeout(
        () => recheckSuppressedAgentBusy(session),
        Math.max(1, session.busySuppressedUntil - Date.now() + 1)
      );
    }
    return;
  }
  window.clearTimeout(session.busyTimer);
  if (!session.busy) {
    session.busy = true;
    updateSessionItem(session);
    schedulePersist();
  }
  session.busyTimer = window.setTimeout(() => settleSessionBusy(session), SESSION_BUSY_SETTLE_MS);
}

function recordSessionResponse(session, data) {
  if (!session || session.exited) return;
  let output = plainTerminalText(data);
  if (Date.now() - session.expectedInputEchoAt <= 1_500) {
    const consumed = consumeTerminalInputEcho(session.expectedInputEcho, output);
    session.expectedInputEcho = consumed.expected;
    output = consumed.response;
  } else {
    session.expectedInputEcho = '';
  }
  if (!output.trim()) return;
  if (restoringWorkspace || Date.now() < session.busySuppressedUntil) return;
  session.lastResponseAt = Date.now();
  window.clearTimeout(session.responseSortTimer);
  session.responseSortTimer = window.setTimeout(() => {
    if (getGroupForSession(session.id)?.sortBy === 'response') renderGroups();
    schedulePersist();
  }, SESSION_BUSY_SETTLE_MS);
}

function noteBackgroundActivity(session, data) {
  if (!session || isSessionForeground(session) || restoringWorkspace) return;
  if (!session.activityArmed) return;
  const meaningfulOutput = plainTerminalText(data).trim();
  if (!meaningfulOutput && !data.includes('\x07')) return;
  if (data.includes('\x07')) {
    session.notifyWhenIdle = false;
    markSessionNotification(session);
    return;
  }
  session.notifyWhenIdle = true;
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
    linkHandler: {
      activate: (event, text) => openTerminalLink(event, text, api.openExternal),
      allowNonHttpProtocols: false
    },
    theme: {
      background: '#0c0c0c', foreground: '#f2f2f2', cursor: '#f2f2f2', cursorAccent: '#0c0c0c', selectionBackground: '#264f78',
      black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
      brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2'
    }
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(pane);
  terminal.registerLinkProvider(createTerminalLinkProvider(terminal, api.openExternal));

  const restoredContext = restoredContextState(options.history, Boolean(options.summary), MAX_CONTEXT_CHARS);
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
    attentionCycleId: String(options.attentionCycleId || (options.notified ? `restored:${id}` : '')).slice(0, 200),
    activityArmed: Boolean(options.activityArmed),
    notifyWhenIdle: false,
    busy: false,
    busyTimer: null,
    busySuppressedUntil: Date.now() + ACTIVATION_REDRAW_SUPPRESS_MS,
    displayName: options.displayName || '',
    summary: options.summary || '',
    agent: options.agent || '',
    manualTitle: Boolean(options.manualTitle),
    links: Array.isArray(options.links)
      ? options.links
        .map((link) => ({ ...link, url: normalizeGithubPullRequestUrl(link?.url) }))
        .filter((link) => link.url)
      : [],
    createdAt: Object.hasOwn(options, 'createdAt')
      ? Math.max(0, Number(options.createdAt) || 0)
      : Date.now(),
    lastResponseAt: Number(options.lastResponseAt) > 0 ? Number(options.lastResponseAt) : 0,
    responseSortTimer: null,
    linkScanBuffer: '',
    context: restoredContext.context,
    commandBuffer: '',
    expectedInputEcho: '',
    expectedInputEchoAt: 0,
    aiSummaryTimer: null,
    aiSummaryMode: '',
    aiSummaryDueAt: 0,
    aiSummaryInFlight: false,
    aiErrorShown: false,
    aiSummaryFailureCount: 0,
    aiSummaryFailureRevision: 0,
    aiInitialSummaryDone: typeof options.aiInitialSummaryDone === 'boolean'
      ? options.aiInitialSummaryDone
      : Boolean(options.summary || restoringWorkspace),
    lastAiSummaryAt: Number(options.lastAiSummaryAt) > 0 ? Number(options.lastAiSummaryAt) : 0,
    contextRevision: restoredContext.contextRevision,
    lastSummarizedRevision: restoredContext.lastSummarizedRevision,
    hasUserActivity: Boolean(options.hasUserActivity),
    activityCycleId: '',
    activityScanBuffer: '',
    lastWorkingAt: 0,
    lastReportedCycleId: '',
    persistent: false
  };
  sessions.set(id, session);
  renderSessionItem(session);
  renderGroups();

  terminal.attachCustomWheelEventHandler((event) => {
    const amount = terminalWheelAmount(event);
    if (amount === null) return true;
    event.preventDefault();
    event.stopPropagation();
    if (session.persistent) api.scroll(session.id, amount);
    else terminal.scrollLines(amount);
    return false;
  });

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
    if (session.manualTitle) return;
    const cleaned = title.trim();
    if (!cleaned) return;
    session.title = cleaned.length > 34 ? `${cleaned.slice(0, 31)}…` : cleaned;
    updateSessionItem(session);
    resortSessionGroupByName(session);
    schedulePersist();
  });
  terminal.onBell(() => {
    if (session.activityArmed) markSessionNotification(session);
  });
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
    session.persistent = Boolean(details.persistent);
    updateSessionItem(session);
  } catch (error) {
    session.exited = true;
    terminal.options.disableStdin = true;
    terminal.writeln(`\r\n\x1b[31mCould not start the shell: ${error.message}\x1b[0m`);
    updateSessionItem(session);
  }

  if (options.activate !== false) activateSession(id);
  scheduleAiSummary(session);
  schedulePersist();
  return session;
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  const ids = orderedSessionIds();
  const index = ids.indexOf(id);
  if (!session.exited) api.close(id);
  session.exited = true;
  window.clearTimeout(session.busyTimer);
  clearAiSummaryTimer(session);
  window.clearTimeout(session.responseSortTimer);
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

async function createNewGroup() {
  const group = createGroup(makeGroupId(), `Group ${groups.length + 1}`);
  groups.push(group);
  activeGroupId = group.id;
  if (sidebarCollapsed) {
    sidebarCollapsed = false;
    updateSidebarState();
  }
  renderGroups();
  schedulePersist();
  await addSession(undefined, { groupId: group.id });
  const title = sessionList.querySelector(`[data-group-id="${group.id}"] .group-title`);
  if (title) startGroupRename(group, title);
}

function deleteGroup(groupId) {
  if (groups.length === 1) {
    showToast('SideTerm needs at least one group');
    return;
  }
  const index = groups.findIndex((group) => group.id === groupId);
  if (index < 0) return;
  const removed = groups[index];
  const sessionCount = removed.sessionIds.filter((id) => sessions.has(id)).length;
  const message = sessionCount > 0
    ? `Kill “${removed.title}” and all ${sessionCount} session${sessionCount === 1 ? '' : 's'} inside?\n\nAny running processes in those sessions will be terminated.`
    : `Delete the empty group “${removed.title}”?`;
  if (!window.confirm(message)) return;

  const fallback = groups[index > 0 ? index - 1 : index + 1];
  const removedActiveSession = removed.sessionIds.includes(activeId);
  for (const sessionId of removed.sessionIds) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    if (!session.exited) api.close(sessionId);
    session.exited = true;
    window.clearTimeout(session.busyTimer);
    clearAiSummaryTimer(session);
    window.clearTimeout(session.responseSortTimer);
    session.terminal.dispose();
    session.pane.remove();
    session.item.remove();
    sessions.delete(sessionId);
  }
  groups = groups.filter((group) => group.id !== groupId);
  if (activeGroupId === groupId) activeGroupId = fallback.id;
  renderGroups();
  if (removedActiveSession) {
    const nextId = orderedSessionIds()[0];
    if (nextId) {
      activateSession(nextId);
    } else {
      activeId = null;
      activeTitle.textContent = 'No session';
      activeSubtitle.textContent = 'Create a session to begin';
      statusDot.classList.remove('stopped');
    }
  }
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
    const sourceGroup = getGroupForSession(dragState.id);
    const targetGroup = getGroup(dropTarget.groupId);
    if (sourceGroup?.id === targetGroup?.id && targetGroup.sortBy !== 'default') {
      showToast('Switch this group to Default sort to change its manual order');
    } else {
      const beforeSessionId = targetGroup?.sortBy === 'default' ? dropTarget.beforeSessionId : null;
      groups = moveSession(
        groups,
        dragState.id,
        dropTarget.groupId,
        beforeSessionId,
        targetGroup?.sortBy === 'default' ? targetGroup.sortDirection : 'asc'
      );
    }
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
  session.terminal.write(data, () => noteSessionBusy(session, data));
  recordSessionResponse(session, data);
  appendSessionContext(session, data);
  noteBackgroundActivity(session, data);
});

api.onRemoteInput(({ id, data }) => {
  const session = sessions.get(id);
  if (session && !session.exited) trackTerminalInput(session, data);
});

api.onExit(({ id, exitCode }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.exited = true;
  session.busy = false;
  reportSessionCompletion(session);
  session.activityArmed = false;
  session.notifyWhenIdle = false;
  window.clearTimeout(session.busyTimer);
  window.clearTimeout(session.responseSortTimer);
  session.terminal.options.disableStdin = true;
  session.terminal.writeln(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m`);
  if (isSessionForeground(session)) {
    activeSubtitle.textContent = `${session.shell} · stopped · ${session.cwd}`;
    statusDot.classList.add('stopped');
  } else {
    markSessionNotification(session);
  }
  updateSessionItem(session);
  if (getGroupForSession(session.id)?.sortBy === 'response') renderGroups();
  else updateVisualState();
  schedulePersist();
});

new ResizeObserver(fitActive).observe(terminalStack);
window.addEventListener('resize', fitActive);
window.addEventListener('blur', releaseTerminalSelectionDrag);
window.addEventListener('focus', handleWindowFocus);
document.addEventListener('visibilitychange', () => {
  releaseTerminalSelectionDrag();
  if (document.visibilityState === 'visible') acknowledgeActiveSessionOnFocus();
});
collapseButton.addEventListener('click', toggleSidebar);
newSessionButton.addEventListener('click', () => void addSession(sessions.get(activeId)?.cwd, { groupId: activeGroupId }));
document.querySelector('#new-group').addEventListener('click', () => void createNewGroup());
document.querySelector('#heading-new-group').addEventListener('click', () => void createNewGroup());
document.querySelector('#copy-button').addEventListener('click', () => void copySelection());
document.querySelector('#paste-button').addEventListener('click', () => void pasteClipboard());
document.querySelector('#open-folder-button').addEventListener('click', () => {
  const session = sessions.get(activeId);
  if (session) void api.openPath(session.cwd);
});
activeTitle.addEventListener('click', () => startSessionRename(sessions.get(activeId), activeTitle));
document.querySelector('#settings-button').addEventListener('click', openSettingsPanel);
document.querySelector('#agent-button').addEventListener('click', () => void openAgentPanel());
document.querySelector('#agent-close').addEventListener('click', closeAgentPanel);
document.querySelector('#agent-chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submitAgentChat();
});
document.querySelector('#agent-chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submitAgentChat();
  }
});
document.querySelector('#mobile-button').addEventListener('click', () => void openMobilePanel());
document.querySelector('#mobile-close').addEventListener('click', closeMobilePanel);
mobileBackdrop.addEventListener('mousedown', (event) => {
  if (event.target === mobileBackdrop) closeMobilePanel();
});
document.querySelector('#mobile-toggle').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const current = await api.getMobileInfo();
    renderMobileInfo(current.enabled ? await api.stopMobile() : await api.startMobile());
  } catch (error) {
    document.querySelector('#mobile-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#enable-tailscale-https').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  document.querySelector('#tailscale-https-status').textContent = 'Configuring private HTTPS…';
  try {
    const result = await api.enableTailscaleHttps();
    renderMobileInfo(result.mobile);
    document.querySelector('#tailscale-https-status').textContent = `Ready at ${result.tailscale.url}`;
    button.hidden = true;
  } catch (error) {
    document.querySelector('#tailscale-https-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
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
document.querySelector('#tts-speed').addEventListener('input', (event) => {
  document.querySelector('#tts-speed-value').textContent = `${Number(event.target.value).toFixed(2)}×`;
});
document.querySelector('#reset-hotkeys').addEventListener('click', () => {
  for (const input of document.querySelectorAll('[data-hotkey-action]')) input.value = DEFAULT_HOTKEYS[input.dataset.hotkeyAction];
});
document.querySelector('#clear-api-key').addEventListener('click', () => {
  clearApiKeyRequested = true;
  document.querySelector('#api-key').value = '';
  document.querySelector('#api-key-state').textContent = 'Key will be removed when saved';
  document.querySelector('#clear-api-key').hidden = true;
  invalidateProviderFeatures();
});
document.querySelector('#api-key').addEventListener('input', (event) => {
  if (event.target.value) clearApiKeyRequested = false;
  invalidateProviderFeatures();
});
document.querySelector('#ai-api-url').addEventListener('input', invalidateProviderFeatures);
document.querySelector('#ai-model').addEventListener('input', invalidateProviderFeatures);
document.querySelector('#ai-enabled').addEventListener('change', (event) => void handleProviderFeatureToggle(event.currentTarget, 'AI session context', 'llmEnabled'));
document.querySelector('#agent-enabled').addEventListener('change', (event) => void handleProviderFeatureToggle(event.currentTarget, 'Supervisor', 'agentEnabled'));
document.querySelector('#ai-continuous-context-enabled').addEventListener('change', syncProviderFeatureAvailability);
document.querySelector('#test-ai').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!providerDraftConfigured()) {
    setProviderStatus('Set up the LLM Provider API URL and model before testing.', true);
    syncProviderFeatureAvailability();
    return;
  }
  const providerFingerprint = providerDraftFingerprint();
  providerValidationInFlight = true;
  syncProviderFeatureAvailability();
  setProviderStatus('Testing…');
  try {
    settings = await api.saveSettings({
      ...providerDraftPayload(),
      llmEnabled: document.querySelector('#ai-enabled').checked,
      agentEnabled: document.querySelector('#agent-enabled').checked
    });
    applySettings();
    const result = await api.testAiSettings();
    if (providerDraftFingerprint() !== providerFingerprint) {
      throw new Error('The provider changed during validation. Test the current settings again.');
    }
    setProviderStatus(`Connected · ${result.name}: ${result.summary}`);
  } catch (error) {
    try {
      await persistDisabledProviderFeatures();
      setProviderStatus(`Set up the LLM Provider: ${error.message}`, true);
    } catch (rollbackError) {
      setProviderStatus(`Provider test failed and AI features could not be disabled: ${rollbackError.message}`, true);
    }
  } finally {
    providerValidationInFlight = false;
    syncProviderFeatureAvailability();
  }
});
document.querySelector('#install-stt').addEventListener('click', () => void installSpeech('stt'));
document.querySelector('#install-tts').addEventListener('click', () => void installSpeech('tts'));
document.querySelector('#stt-provider').addEventListener('change', () => {
  clearSttCredentialRequested = true;
  document.querySelector('#stt-credential').value = '';
  document.querySelector('#stt-credential').placeholder = 'Enter the selected provider credential';
  document.querySelector('#stt-credential-state').textContent = 'Credential cleared for provider change';
  document.querySelector('#clear-stt-credential').hidden = true;
  document.querySelector('#stt-endpoint').value = '';
  document.querySelector('#stt-region').value = '';
  syncSttProviderFields();
  document.querySelector('#stt-status').textContent = document.querySelector('#stt-provider').value === 'parakeet'
    ? 'LOCAL — Parakeet'
    : 'CLOUD — save settings to configure';
});
document.querySelector('#stt-credential').addEventListener('input', (event) => {
  if (event.target.value) clearSttCredentialRequested = false;
});
document.querySelector('#clear-stt-credential').addEventListener('click', () => {
  clearSttCredentialRequested = true;
  document.querySelector('#stt-credential').value = '';
  document.querySelector('#stt-credential').placeholder = 'Credential will be removed on save';
  document.querySelector('#stt-credential-state').textContent = 'Credential will be removed';
  document.querySelector('#clear-stt-credential').hidden = true;
});
document.querySelector('#preview-voice').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Generating…';
  try {
    await playSpeechAudio(await api.previewVoice(
      document.querySelector('#tts-voice').value,
      Number(document.querySelector('#tts-speed').value)
    ));
  } catch (error) {
    showToast(`Voice preview: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Play preview';
  }
});
document.querySelector('#desktop-voice-toggle').addEventListener('click', async () => {
  if (desktopVoiceMode) {
    stopDesktopVoiceMode();
    return;
  }
  try {
    await startDesktopVoiceMode();
  } catch (error) {
    showToast(`Voice: ${error.message}`);
  }
});
sidebarResizer.addEventListener('pointerdown', beginSidebarResize);
linkPopover.addEventListener('mouseenter', () => window.clearTimeout(linkPopoverTimer));
linkPopover.addEventListener('mouseleave', hideLinkPopoverSoon);
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.group-sort-wrap')) closeGroupSortMenus();
});
api.onAgentState(renderAgentState);
api.onAgentVoicePing(({ text, acknowledgement } = {}) => {
  if (desktopVoiceMode) void queueAgentSpeech(String(text || ''), { openReplyWindow: !acknowledgement });
});
api.onAgentAction((action) => void handleAgentAction(action));
api.onSpeechStatus(renderSpeechStatus);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sessionList.querySelector('.group-sort[aria-expanded="true"]')) {
    event.preventDefault();
    closeGroupSortMenus();
    return;
  }
  if (supervisorDashboardActive && event.key === 'Escape') {
    event.preventDefault();
    closeAgentPanel();
    return;
  }
  if (!mobileBackdrop.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeMobilePanel();
    return;
  }
  if (!settingsBackdrop.hidden && event.key === 'Escape') {
    event.preventDefault();
    closeSettingsPanel();
    return;
  }
  if (event.target instanceof Element && event.target.closest('.settings-panel, .mobile-panel, .supervisor-dashboard')) return;
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
      manualTitle: saved.manualTitle,
      shell: saved.shell,
      history: saved.history,
      notified: saved.notified,
      attentionCycleId: saved.attentionCycleId,
      activityArmed: saved.activityArmed,
      displayName: saved.displayName,
      summary: saved.summary,
      agent: saved.agent,
      hasUserActivity: saved.hasUserActivity,
      aiInitialSummaryDone: saved.aiInitialSummaryDone,
      lastAiSummaryAt: saved.lastAiSummaryAt,
      createdAt: saved.createdAt,
      lastResponseAt: saved.lastResponseAt,
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
  try {
    renderAgentState(await api.getAgentState());
  } catch {
    // The terminal remains usable if the optional supervisor is unavailable.
  }
}

void initializeApp();
