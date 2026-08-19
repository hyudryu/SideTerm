const terminalElement = document.querySelector('#mobile-terminal');
const drawer = document.querySelector('#drawer');
const shade = document.querySelector('#drawer-shade');
const sessionList = document.querySelector('#mobile-sessions');
const connectionDot = document.querySelector('#connection-dot');
const connectionDetail = document.querySelector('#connection-detail');
const mobileTitle = document.querySelector('#mobile-title');
const mobileSubtitle = document.querySelector('#mobile-subtitle');
const installButton = document.querySelector('#install-button');
const inputForm = document.querySelector('#mobile-input-bar');
const inputBar = document.querySelector('#mobile-input');
const terminalView = document.querySelector('#terminal-view');
const agentDashboard = document.querySelector('#agent-dashboard');
const modeToggle = document.querySelector('#mode-toggle');
const mobileAgentChat = document.querySelector('#mobile-agent-chat');
const mobileAgentForm = document.querySelector('#mobile-agent-form');
const mobileAgentInput = document.querySelector('#mobile-agent-input');
const mobileVoiceToggle = document.querySelector('#mobile-voice-toggle');
const basePath = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
const socketUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${basePath}socket`;
const unread = new Set();
let socket;
let reconnectTimer;
let activeId = null;
let groups = [];
let sessions = [];
let installPrompt = null;
let agentState = { enabled: false, status: 'idle', messages: [], notifications: [], confirmations: [] };
let viewMode = 'terminal';
let agentViewInitialized = false;
let catchupRequested = false;
let mobileVoiceMode = false;
let voiceStream = null;
let voiceContext = null;
let voiceRecorder = null;
let voiceFrame = null;

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
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function setView(mode) {
  viewMode = mode === 'agent' && agentState.enabled ? 'agent' : 'terminal';
  const showingAgent = viewMode === 'agent';
  agentDashboard.hidden = !showingAgent;
  terminalView.hidden = showingAgent;
  modeToggle.textContent = showingAgent ? 'Terminal' : 'Agent';
  modeToggle.hidden = !agentState.enabled;
  if (showingAgent) {
    mobileTitle.textContent = 'Supervisor';
    mobileSubtitle.textContent = agentState.status === 'thinking' ? 'Thinking…' : 'All sessions';
  } else {
    const session = sessions.find((item) => item.id === activeId);
    mobileTitle.textContent = session?.title || 'SideTerm';
    mobileSubtitle.textContent = session?.subtitle || 'Terminal session';
    window.setTimeout(resizeTerminal, 50);
  }
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
  setView('terminal');
  send({ type: 'select', id });
  window.setTimeout(() => terminal.focus(), 80);
}

function renderAgentState(state) {
  agentState = { ...agentState, ...(state || {}) };
  if (agentState.enabled && !agentViewInitialized) {
    agentViewInitialized = true;
    setView('agent');
  } else if (!agentState.enabled && viewMode === 'agent') {
    setView('terminal');
  }
  modeToggle.hidden = !agentState.enabled;
  const dot = document.querySelector('#agent-mobile-dot');
  dot.className = agentState.status === 'thinking' ? 'thinking' : agentState.status === 'error' ? 'error' : '';
  document.querySelector('#agent-mobile-status').textContent = !agentState.enabled ? 'Supervisor disabled' : agentState.status === 'thinking' ? 'Thinking…' : 'Supervisor ready';
  document.querySelector('#agent-mobile-detail').textContent = !agentState.enabled ? 'Enable it from desktop Settings' : mobileVoiceMode ? 'Listening locally' : 'Watching all sessions';
  const unreadNotifications = (agentState.notifications || []).filter((item) => !item.read);
  document.querySelector('#mobile-notification-count').textContent = String(unreadNotifications.length);
  const notificationList = document.querySelector('#mobile-notifications');
  notificationList.replaceChildren();
  const visible = (agentState.notifications || []).slice(-8).reverse();
  if (!visible.length) {
    const empty = document.createElement('span');
    empty.className = 'mobile-agent-empty';
    empty.textContent = 'No updates yet.';
    notificationList.append(empty);
  }
  for (const item of visible) {
    const card = document.createElement('article');
    card.className = 'mobile-notification';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const summary = document.createElement('span');
    summary.textContent = item.summary || (item.read ? 'Update delivered' : 'Finished · awaiting summary');
    card.append(title, summary);
    notificationList.append(card);
  }
  mobileAgentChat.replaceChildren();
  if (!(agentState.messages || []).length) {
    const empty = document.createElement('div');
    empty.className = 'mobile-agent-empty';
    empty.textContent = 'Ask for a status update or what to do next.';
    mobileAgentChat.append(empty);
  }
  for (const message of agentState.messages || []) {
    const bubble = document.createElement('div');
    bubble.className = `mobile-agent-message ${message.role}`;
    bubble.textContent = message.text;
    mobileAgentChat.append(bubble);
  }
  mobileAgentChat.scrollTop = mobileAgentChat.scrollHeight;
  const confirmations = document.querySelector('#mobile-confirmations');
  confirmations.replaceChildren();
  for (const confirmation of agentState.confirmations || []) {
    const row = document.createElement('div');
    row.className = 'mobile-confirmation';
    const text = document.createElement('span');
    text.textContent = confirmation.kind === 'archive' ? `Archive ${confirmation.title}?` : `Send to ${confirmation.title}: ${confirmation.input}`;
    const deny = document.createElement('button');
    deny.textContent = 'Deny';
    const approve = document.createElement('button');
    approve.textContent = 'Approve';
    deny.addEventListener('click', () => send({ type: 'agent:confirm', id: confirmation.id, approved: false }));
    approve.addEventListener('click', () => send({ type: 'agent:confirm', id: confirmation.id, approved: true }));
    row.append(text, deny, approve);
    confirmations.append(row);
  }
  if (agentState.enabled && unreadNotifications.length && !catchupRequested) {
    catchupRequested = send({ type: 'agent:catch-up', voiceMode: mobileVoiceMode });
  }
  if (viewMode === 'agent') setView('agent');
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
    catchupRequested = false;
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
    if (message.type === 'agent:state') renderAgentState(message.state);
    if (message.type === 'agent:error') {
      document.querySelector('#agent-mobile-detail').textContent = message.message;
      document.querySelector('#agent-mobile-dot').className = 'error';
    }
    if (message.type === 'voice:transcript') {
      document.querySelector('#mobile-wave-detail').textContent = message.transcript.ignored
        ? message.transcript.reason
        : message.transcript.text;
    }
    if (message.type === 'voice:audio') void playMobileAudio(message.audio);
  });
  socket.addEventListener('close', () => {
    connectionDot.classList.remove('online');
    connectionDetail.textContent = 'Disconnected · retrying';
    reconnectTimer = window.setTimeout(connect, 1_500);
  });
  socket.addEventListener('error', () => socket.close());
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function playMobileAudio(audio) {
  if (!audio?.data) return;
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    const player = new Audio(`data:${audio.mimeType || 'audio/wav'};base64,${audio.data}`);
    await player.play();
    await new Promise((resolve) => player.addEventListener('ended', resolve, { once: true }));
  } catch (error) {
    document.querySelector('#mobile-wave-detail').textContent = error.message;
  } finally {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }
}

async function submitVoiceBlob(blob, duration) {
  if (!mobileVoiceMode || duration < 650 || blob.size < 1000) return;
  document.querySelector('#mobile-wave-detail').textContent = 'Transcribing locally…';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  send({ type: 'voice:transcribe', data: bytesToBase64(bytes), mimeType: blob.type, sendToAgent: true, speakResponse: true });
}

async function startMobileVoice() {
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    throw new Error('Mobile microphone access requires an HTTPS Tailscale URL or localhost.');
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser does not expose microphone recording.');
  voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  voiceContext = new AudioContext();
  const source = voiceContext.createMediaStreamSource(voiceStream);
  const analyser = voiceContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let header = null;
  let preRoll = [];
  let utterance = [];
  let speaking = false;
  let startedAt = 0;
  let silenceAt = 0;
  voiceRecorder = new MediaRecorder(voiceStream);
  voiceRecorder.addEventListener('dataavailable', (event) => {
    if (!event.data.size) return;
    if (!header) { header = event.data; return; }
    if (speaking) utterance.push(event.data);
    else {
      preRoll.push(event.data);
      if (preRoll.length > 5) preRoll.shift();
    }
  });
  voiceRecorder.start(220);
  mobileVoiceMode = true;
  agentDashboard.classList.add('voice-mode');
  document.querySelector('#mobile-waveform').hidden = false;
  mobileVoiceToggle.textContent = 'Voice on';
  mobileVoiceToggle.classList.add('active');
  const monitor = () => {
    if (!mobileVoiceMode || !voiceContext) return;
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    const now = performance.now();
    if (rms > 0.04) {
      if (!speaking) { speaking = true; startedAt = now; utterance = [...preRoll]; }
      silenceAt = 0;
    } else if (speaking) {
      silenceAt ||= now;
      if (now - silenceAt > 850 || now - startedAt > 14_000) {
        const blob = new Blob(header ? [header, ...utterance] : utterance, { type: voiceRecorder.mimeType || 'audio/webm' });
        const duration = now - startedAt;
        speaking = false;
        silenceAt = 0;
        utterance = [];
        preRoll = [];
        void submitVoiceBlob(blob, duration);
      }
    }
    voiceFrame = requestAnimationFrame(monitor);
  };
  voiceFrame = requestAnimationFrame(monitor);
}

function stopMobileVoice() {
  mobileVoiceMode = false;
  if (voiceFrame) cancelAnimationFrame(voiceFrame);
  voiceFrame = null;
  if (voiceRecorder?.state !== 'inactive') voiceRecorder.stop();
  voiceRecorder = null;
  for (const track of voiceStream?.getTracks() || []) track.stop();
  voiceStream = null;
  void voiceContext?.close();
  voiceContext = null;
  agentDashboard.classList.remove('voice-mode');
  document.querySelector('#mobile-waveform').hidden = true;
  mobileVoiceToggle.textContent = 'Voice off';
  mobileVoiceToggle.classList.remove('active');
}

terminal.onData((data) => { if (activeId) send({ type: 'input', id: activeId, data }); });
let touchY = null;
let touchDistance = 0;
let scrollRemainder = 0;
terminalElement.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  touchY = event.touches[0].clientY;
  touchDistance = 0;
  scrollRemainder = 0;
}, { passive: true });
terminalElement.addEventListener('touchmove', (event) => {
  if (touchY === null || event.touches.length !== 1) return;
  const nextY = event.touches[0].clientY;
  const delta = nextY - touchY;
  touchY = nextY;
  touchDistance += Math.abs(delta);
  scrollRemainder += delta;
  const lines = Math.trunc(scrollRemainder / 14);
  if (lines) {
    terminal.scrollLines(-lines);
    scrollRemainder -= lines * 14;
  }
  if (touchDistance > 6) event.preventDefault();
}, { passive: false });
terminalElement.addEventListener('touchend', () => {
  if (touchDistance <= 6) terminal.focus();
  touchY = null;
  touchDistance = 0;
  scrollRemainder = 0;
});
new ResizeObserver(resizeTerminal).observe(terminalElement);
window.addEventListener('orientationchange', () => window.setTimeout(resizeTerminal, 120));
document.querySelector('#menu-button').addEventListener('click', () => setDrawer(true));
modeToggle.addEventListener('click', () => setView(viewMode === 'agent' ? 'terminal' : 'agent'));
document.querySelector('#drawer-close').addEventListener('click', () => setDrawer(false));
shade.addEventListener('click', () => setDrawer(false));
inputBar.addEventListener('input', () => {
  inputBar.style.height = 'auto';
  inputBar.style.height = `${Math.min(86, inputBar.scrollHeight)}px`;
});
inputBar.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    inputForm.requestSubmit();
  }
});
inputForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!activeId) return;
  const value = inputBar.value;
  if (!value && !send({ type: 'input', id: activeId, data: '\r' })) return;
  if (value && !send({ type: 'input', id: activeId, data: `${value}\r` })) return;
  inputBar.value = '';
  inputBar.style.height = 'auto';
  inputBar.focus();
});
mobileAgentInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    mobileAgentForm.requestSubmit();
  }
});
mobileAgentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = mobileAgentInput.value.trim();
  if (!text || !send({ type: 'agent:chat', text, voiceMode: mobileVoiceMode })) return;
  mobileAgentInput.value = '';
});
mobileVoiceToggle.addEventListener('click', async () => {
  if (mobileVoiceMode) { stopMobileVoice(); return; }
  try {
    await startMobileVoice();
  } catch (error) {
    document.querySelector('#agent-mobile-detail').textContent = error.message;
  }
});
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
