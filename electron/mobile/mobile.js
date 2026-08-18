const terminalElement = document.querySelector('#mobile-terminal');
const drawer = document.querySelector('#drawer');
const shade = document.querySelector('#drawer-shade');
const sessionList = document.querySelector('#mobile-sessions');
const connectionDot = document.querySelector('#connection-dot');
const connectionDetail = document.querySelector('#connection-detail');
const mobileTitle = document.querySelector('#mobile-title');
const mobileSubtitle = document.querySelector('#mobile-subtitle');
const installButton = document.querySelector('#install-button');
const basePath = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
const socketUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${basePath}socket`;
const unread = new Set();
let socket;
let reconnectTimer;
let activeId = null;
let groups = [];
let sessions = [];
let installPrompt = null;

const terminal = new Terminal({
  cursorBlink: true,
  cursorStyle: 'bar',
  fontFamily: "'Cascadia Code', 'Ubuntu Mono', ui-monospace, monospace",
  fontSize: 13,
  lineHeight: 1.12,
  scrollback: 6000,
  allowTransparency: false,
  theme: {
    background: '#0c0c0c', foreground: '#f2f2f2', cursor: '#f2f2f2', selectionBackground: '#264f78',
    black: '#0c0c0c', red: '#e74856', green: '#16c60c', yellow: '#f9f1a5', blue: '#3b78ff', magenta: '#b4009e', cyan: '#61d6d6', white: '#cccccc'
  }
});
terminal.open(terminalElement);

function resizeTerminal() {
  const width = Math.max(200, terminalElement.clientWidth - 14);
  const height = Math.max(120, terminalElement.clientHeight - 10);
  terminal.resize(Math.max(24, Math.floor(width / 7.9)), Math.max(8, Math.floor(height / 16.8)));
}

function setDrawer(open) {
  drawer.classList.toggle('open', open);
  shade.hidden = !open;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function selectSession(id) {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  activeId = id;
  unread.delete(id);
  terminal.reset();
  terminal.write('\x1b[2mConnecting to session…\x1b[0m\r\n');
  mobileTitle.textContent = session.title;
  mobileSubtitle.textContent = session.subtitle || 'Terminal session';
  renderSessions();
  setDrawer(false);
  send({ type: 'select', id });
  window.setTimeout(() => terminal.focus(), 80);
}

function renderSessions() {
  sessionList.replaceChildren();
  const grouped = groups.length ? groups : [{ id: '', title: 'Sessions', color: '#60cdff', sessionIds: sessions.map((session) => session.id) }];
  for (const group of grouped) {
    const groupSessions = group.sessionIds.map((id) => sessions.find((session) => session.id === id)).filter(Boolean);
    if (!groupSessions.length) continue;
    const section = document.createElement('section');
    section.className = 'mobile-group';
    const heading = document.createElement('div');
    heading.className = 'mobile-group-title';
    heading.style.setProperty('--group-color', group.color || '#60cdff');
    heading.innerHTML = '<i></i><span></span>';
    heading.querySelector('span').textContent = group.title || 'Group';
    section.append(heading);
    for (const session of groupSessions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-session';
      button.classList.toggle('active', session.id === activeId);
      button.classList.toggle('unread', unread.has(session.id));
      button.classList.toggle('notified', session.notified);
      button.innerHTML = '<span><strong></strong><small></small></span><i></i>';
      button.querySelector('strong').textContent = session.title;
      button.querySelector('small').textContent = session.subtitle || 'Terminal session';
      button.addEventListener('click', () => selectSession(session.id));
      section.append(button);
    }
    sessionList.append(section);
  }
}

function connect() {
  window.clearTimeout(reconnectTimer);
  connectionDetail.textContent = 'Connecting…';
  socket = new WebSocket(socketUrl);
  socket.addEventListener('open', () => {
    connectionDot.classList.add('online');
    connectionDetail.textContent = 'Connected securely';
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'snapshot') {
      groups = message.groups || [];
      sessions = message.sessions || [];
      if (!sessions.some((session) => session.id === activeId)) activeId = null;
      renderSessions();
      if (!activeId && sessions[0]) selectSession(sessions[0].id);
    }
    if (message.type === 'reset' && message.id === activeId) {
      terminal.reset();
      terminal.write(String(message.data || '').replace(/\n/g, '\r\n'));
      terminal.scrollToBottom();
    }
    if (message.type === 'data') {
      if (message.id === activeId) terminal.write(message.data);
      else unread.add(message.id);
      renderSessions();
    }
    if (message.type === 'exit' && message.id === activeId) terminal.write(`\r\n\x1b[31m[Process exited with code ${message.exitCode}]\x1b[0m\r\n`);
  });
  socket.addEventListener('close', () => {
    connectionDot.classList.remove('online');
    connectionDetail.textContent = 'Disconnected · retrying';
    reconnectTimer = window.setTimeout(connect, 1_500);
  });
  socket.addEventListener('error', () => socket.close());
}

terminal.onData((data) => { if (activeId) send({ type: 'input', id: activeId, data }); });
new ResizeObserver(resizeTerminal).observe(terminalElement);
window.addEventListener('orientationchange', () => window.setTimeout(resizeTerminal, 120));
document.querySelector('#menu-button').addEventListener('click', () => setDrawer(true));
document.querySelector('#drawer-close').addEventListener('click', () => setDrawer(false));
shade.addEventListener('click', () => setDrawer(false));
document.querySelector('#quick-keys').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  const keys = { escape: '\x1b', tab: '\t', interrupt: '\x03', 'clear-line': '\x15', up: '\x1b[A', down: '\x1b[B', enter: '\r' };
  if (button && activeId) send({ type: 'input', id: activeId, data: keys[button.dataset.key] });
  terminal.focus();
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installButton.hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
resizeTerminal();
connect();
