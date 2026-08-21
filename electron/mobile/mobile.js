const terminalElement = document.querySelector('#mobile-terminal');
const VOICE_REPLY_WINDOW_MS = 30_000;
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
const mobileCreateBackdrop = document.querySelector('#mobile-create-backdrop');
const mobileCreateForm = document.querySelector('#mobile-create-sheet');
const mobileCreateGroup = document.querySelector('#mobile-create-group');
const mobileCreateGroupName = document.querySelector('#mobile-create-group-name');
const mobileCreateName = document.querySelector('#mobile-create-name');
const mobileCreateCwd = document.querySelector('#mobile-create-cwd');
const mobileCreateSubmit = document.querySelector('#mobile-create-submit');
const mobileSettingsBackdrop = document.querySelector('#mobile-settings-backdrop');
const mobileSettingsForm = document.querySelector('#mobile-settings-sheet');
const basePath = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
const socketUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${basePath}socket`;
const unread = new Set();
let socket;
let reconnectTimer;
let socketHasSnapshot = false;
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
let mobileTranscriptionInFlight = false;
let activeMobileVoicePlayer = null;
let mobileBargeInStartedAt = 0;
let mobileReplyUntil = 0;
let mobileSttLocation = 'local';
let mobileSttProviderName = 'NVIDIA Parakeet';
let mobileVoiceActivationId = '';
let mobileVoiceInteractionId = '';
let mobileAudioQueue = Promise.resolve(true);
let mobileCreateKind = 'session';
let pendingMobileCreateRequestId = '';
let pendingCreatedSessionId = '';
let pendingMobileCreateTimer = null;

function queueMobileAudio(message) {
  mobileAudioQueue = mobileAudioQueue
    .catch(() => false)
    .then(() => mobileVoiceMode ? playMobileAudio(message.audio, { openReplyWindow: Boolean(message.opensReplyWindow) }) : false);
  return mobileAudioQueue.then((speechCompleted) => {
    if (!message.continueCatchUp) return speechCompleted;
    if (!speechCompleted) releaseCatchUpQueue();
    else requestNextCatchUp(message.catchUpHasMore);
    return speechCompleted;
  });
}

function releaseCatchUpQueue() {
  if (catchupRequested) send({ type: 'agent:catch-up-release' });
  catchupRequested = false;
}

function requestNextCatchUp(hasMore = true) {
  const unreadRemain = agentState.notifications.some((item) => !item.read);
  if ((!hasMore && !unreadRemain) || viewMode !== 'agent' || !agentState.enabled) {
    releaseCatchUpQueue();
    return;
  }
  if (!send({ type: 'agent:catch-up', voiceMode: mobileVoiceMode })) catchupRequested = false;
}

async function handleCatchUpResult(message) {
  if (message.error) {
    releaseCatchUpQueue();
    document.querySelector('#agent-mobile-detail').textContent = message.error;
    document.querySelector('#agent-mobile-dot').className = 'error';
    return;
  }
  if (!message.response) {
    if (message.hasMore) requestNextCatchUp(true);
    else releaseCatchUpQueue();
    return;
  }
  if (mobileVoiceMode) {
    const sent = send({
      type: 'voice:synthesize',
      text: message.speech || message.response,
      continueCatchUp: true,
      catchUpHasMore: Boolean(message.hasMore)
    });
    if (!sent) releaseCatchUpQueue();
    return;
  }
  requestNextCatchUp(message.hasMore);
}

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
const terminalFrames = new SideTermTerminalFrames.TerminalFrameWriter({
  reset: () => terminal.reset(),
  write: (data, callback) => terminal.write(data, callback),
  scrollToBottom: () => terminal.scrollToBottom(),
  captureViewport: () => {
    const buffer = terminal.buffer.active;
    return { atBottom: buffer.viewportY >= buffer.baseY, distanceFromBottom: Math.max(0, buffer.baseY - buffer.viewportY) };
  },
  restoreViewport: ({ distanceFromBottom }) => {
    const buffer = terminal.buffer.active;
    terminal.scrollToLine(Math.max(0, buffer.baseY - Math.max(0, Number(distanceFromBottom) || 0)));
  }
});

function resizeTerminal() {
  const width = Math.max(200, terminalElement.clientWidth - 14);
  const height = Math.max(120, terminalElement.clientHeight - 10);
  terminal.resize(Math.max(24, Math.floor(width / 7.9)), Math.max(8, Math.floor(height / 16.8)));
}

function setDrawer(open) {
  drawer.classList.toggle('open', open);
  shade.hidden = !open;
}

function closeMobileCreate() {
  mobileCreateBackdrop.hidden = true;
}

function openMobileCreate(kind) {
  mobileCreateKind = kind === 'group' ? 'group' : 'session';
  setDrawer(false);
  mobileCreateForm.reset();
  mobileCreateGroup.replaceChildren();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.title || 'Group';
    mobileCreateGroup.append(option);
  }
  const activeSession = sessions.find((session) => session.id === activeId);
  const activeGroup = groups.find((group) => group.sessionIds.includes(activeId));
  mobileCreateGroup.value = activeGroup?.id || groups[0]?.id || '';
  mobileCreateCwd.value = activeSession?.cwd || '';
  const creatingGroup = mobileCreateKind === 'group';
  document.querySelector('#mobile-create-title').textContent = creatingGroup ? 'New group' : 'New session';
  document.querySelector('#mobile-create-subtitle').textContent = creatingGroup ? 'Start a group with its first terminal' : 'Create a terminal in an existing group';
  document.querySelector('#mobile-create-group-name-row').hidden = !creatingGroup;
  document.querySelector('#mobile-create-group-row').hidden = creatingGroup;
  document.querySelector('#mobile-create-name-label').textContent = creatingGroup ? 'First session name (optional)' : 'Session name (optional)';
  document.querySelector('#mobile-create-status').textContent = '';
  mobileCreateSubmit.disabled = false;
  mobileCreateBackdrop.hidden = false;
  window.setTimeout(() => (creatingGroup ? mobileCreateGroupName : mobileCreateName).focus(), 40);
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
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  terminalFrames.select(id, '\x1b[2mConnecting to session…\x1b[0m\n');
  mobileTitle.textContent = session.title;
  mobileSubtitle.textContent = session.subtitle || 'Terminal session';
  renderSessions();
  setDrawer(false);
  setView('terminal');
  send({ type: 'select', id, requestId });
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
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = confirmation.kind === 'archive'
      ? `Archive ${confirmation.title}?`
      : confirmation.kind === 'github-comment'
        ? `Post comment to ${confirmation.pullRequestUrl}?`
        : confirmation.kind === 'merge-pull-request'
          ? `Merge ${confirmation.title}?`
        : `Send input to ${confirmation.title}?`;
    const detail = document.createElement('code');
    detail.textContent = confirmation.kind === 'archive'
      ? confirmation.summary
      : confirmation.kind === 'github-comment'
        ? confirmation.body
        : confirmation.kind === 'merge-pull-request'
          ? confirmation.pullRequestUrl
        : confirmation.input;
    copy.append(heading, detail);
    if (confirmation.kind === 'github-comment') row.classList.add('github-comment');
    const deny = document.createElement('button');
    deny.textContent = 'Deny';
    const approve = document.createElement('button');
    approve.textContent = 'Approve';
    const respond = (approved) => {
      deny.disabled = true;
      approve.disabled = true;
      send({ type: 'agent:confirm', id: confirmation.id, approved });
    };
    deny.addEventListener('click', () => respond(false));
    approve.addEventListener('click', () => respond(true));
    row.append(copy, deny, approve);
    confirmations.append(row);
  }
  if (agentState.enabled && agentState.status !== 'thinking' && unreadNotifications.length && !catchupRequested) {
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
  socketHasSnapshot = false;
  connectionDetail.textContent = 'Connecting…';
  socket = new WebSocket(socketUrl);
  socket.addEventListener('open', () => {
    connectionDot.classList.add('online');
    connectionDetail.textContent = 'Connected securely';
    catchupRequested = false;
    mobileTranscriptionInFlight = false;
    resetPendingMobileCreate('Connection restored. Please try again.');
    if (mobileVoiceMode) send({ type: 'voice:mode', enabled: true, activationId: mobileVoiceActivationId });
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'snapshot') {
      const shouldRestoreSelection = !socketHasSnapshot;
      socketHasSnapshot = true;
      groups = message.groups || [];
      sessions = message.sessions || [];
      if (!sessions.some((session) => session.id === activeId)) activeId = null;
      renderSessions();
      if (pendingCreatedSessionId && sessions.some((session) => session.id === pendingCreatedSessionId)) {
        const createdId = pendingCreatedSessionId;
        pendingCreatedSessionId = '';
        selectSession(createdId);
      } else if (!activeId && sessions[0]) selectSession(sessions[0].id);
      else if (activeId && shouldRestoreSelection) selectSession(activeId);
    }
    if ((message.type === 'terminal:frame' || message.type === 'reset') && message.id === activeId) {
      terminalFrames.render(message.id, message.data);
    }
    if (message.type === 'terminal:activity' && message.id !== activeId) {
      unread.add(message.id);
      renderSessions();
    }
    if (message.type === 'exit' && message.id === activeId) {
      mobileSubtitle.textContent = `Process exited with code ${message.exitCode}`;
    }
    if (message.type === 'agent:state') renderAgentState(message.state);
    if (message.type === 'mobile:settings') {
      document.querySelector('#mobile-wake-word').value = message.settings?.wakeWord || 'Hey Agent';
      document.querySelector('#mobile-tts-voice').value = message.settings?.ttsVoice || 'alba';
      document.querySelector('#mobile-tts-speed').value = String(message.settings?.ttsSpeed || 1);
      document.querySelector('#mobile-tts-speed-value').textContent = `${Number(message.settings?.ttsSpeed || 1).toFixed(2)}×`;
      document.querySelector('#mobile-settings-status').textContent = message.saved ? 'Saved' : '';
      mobileSttProviderName = message.settings?.sttProviderName || 'NVIDIA Parakeet';
      mobileSttLocation = message.settings?.sttLocation === 'cloud' ? 'cloud' : 'local';
    }
    if (message.type === 'mobile:settings:error') {
      document.querySelector('#mobile-settings-status').textContent = message.message;
    }
    if (message.type === 'mobile:create-result' && message.requestId === pendingMobileCreateRequestId) {
      window.clearTimeout(pendingMobileCreateTimer);
      pendingMobileCreateTimer = null;
      pendingMobileCreateRequestId = '';
      mobileCreateSubmit.disabled = false;
      if (message.error) {
        document.querySelector('#mobile-create-status').textContent = message.error;
      } else {
        pendingCreatedSessionId = message.created?.id || '';
        closeMobileCreate();
        if (pendingCreatedSessionId && sessions.some((session) => session.id === pendingCreatedSessionId)) {
          const createdId = pendingCreatedSessionId;
          pendingCreatedSessionId = '';
          selectSession(createdId);
        }
      }
    }
    if (message.type === 'agent:error') {
      document.querySelector('#agent-mobile-detail').textContent = message.message;
      document.querySelector('#agent-mobile-dot').className = 'error';
    }
    if (message.type === 'voice:transcript') {
      mobileTranscriptionInFlight = false;
      if (!message.transcript.ignored) mobileReplyUntil = 0;
      if (message.transcript.clarification?.interactionId) {
        mobileVoiceInteractionId = message.transcript.clarification.interactionId;
      } else if (!message.transcript.ignored) {
        mobileVoiceInteractionId = '';
      }
      document.querySelector('#mobile-wave-detail').textContent = message.transcript.ignored
        ? message.transcript.reason
        : message.transcript.text;
    }
    if (message.type === 'voice:status') {
      mobileSttLocation = message.status?.sttLocation === 'cloud' ? 'cloud' : 'local';
      mobileSttProviderName = message.status?.sttProviderName || 'NVIDIA Parakeet';
    }
    if (message.type === 'agent:catch-up-result') void handleCatchUpResult(message);
    if (message.type === 'agent:catch-up-busy') catchupRequested = false;
    if (message.type === 'voice:audio') {
      if (message.continueCatchUp && !mobileVoiceMode) {
        releaseCatchUpQueue();
      } else void queueMobileAudio(message);
    }
    if (message.type === 'voice:error') {
      mobileTranscriptionInFlight = false;
      document.querySelector('#agent-mobile-detail').textContent = message.message;
      if (message.continueCatchUp) releaseCatchUpQueue();
    }
  });
  socket.addEventListener('close', () => {
    connectionDot.classList.remove('online');
    connectionDetail.textContent = 'Disconnected · retrying';
    mobileTranscriptionInFlight = false;
    resetPendingMobileCreate('Connection was interrupted. Please try again after reconnecting.');
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

async function playMobileAudio(audio, { openReplyWindow = false } = {}) {
  if (!audio?.data) return false;
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    const player = new Audio(`data:${audio.mimeType || 'audio/wav'};base64,${audio.data}`);
    activeMobileVoicePlayer = player;
    mobileBargeInStartedAt = 0;
    player.playbackRate = Math.max(0.75, Math.min(1.5, Number(audio.playbackRate) || 1));
    await player.play();
    const completed = await new Promise((resolve) => {
      player.addEventListener('ended', () => resolve(true), { once: true });
      player.addEventListener('sideterm-interrupted', () => resolve(false), { once: true });
    });
    if (completed && openReplyWindow) mobileReplyUntil = Date.now() + VOICE_REPLY_WINDOW_MS;
    return completed;
  } catch (error) {
    document.querySelector('#mobile-wave-detail').textContent = error.message;
    return false;
  } finally {
    activeMobileVoicePlayer = null;
    mobileBargeInStartedAt = 0;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }
}

function interruptMobileVoicePlayback() {
  const player = activeMobileVoicePlayer;
  if (!player) return false;
  activeMobileVoicePlayer = null;
  player.pause();
  player.dispatchEvent(new Event('sideterm-interrupted'));
  return true;
}

async function submitVoiceBlob(blob, duration) {
  if (!mobileVoiceMode || mobileTranscriptionInFlight || duration < 650 || blob.size < 1000) return;
  document.querySelector('#mobile-wave-detail').textContent = mobileSttLocation === 'local'
    ? 'Transcribing locally with Parakeet…'
    : `Transcribing with ${mobileSttProviderName}…`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  mobileTranscriptionInFlight = send({
    type: 'voice:transcribe',
    data: bytesToBase64(bytes),
    mimeType: blob.type,
    allowWithoutWakeWord: Date.now() <= mobileReplyUntil,
    interactionId: mobileVoiceInteractionId,
    sendToAgent: true,
    speakResponse: true
  });
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
  mobileVoiceActivationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  send({ type: 'voice:mode', enabled: true, activationId: mobileVoiceActivationId });
  agentDashboard.classList.add('voice-mode');
  document.querySelector('#mobile-waveform').hidden = false;
  mobileVoiceToggle.textContent = 'Voice on';
  mobileVoiceToggle.classList.add('active');
  const monitor = () => {
    if (!mobileVoiceMode || !voiceContext) return;
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    const now = performance.now();
    if (activeMobileVoicePlayer) {
      if (rms > 0.08) {
        mobileBargeInStartedAt ||= now;
        if (now - mobileBargeInStartedAt >= 280) {
          interruptMobileVoicePlayback();
          speaking = true;
          startedAt = now;
          silenceAt = 0;
          utterance = [];
          preRoll = [];
        }
      } else {
        mobileBargeInStartedAt = 0;
      }
    } else if (rms > 0.04) {
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
  interruptMobileVoicePlayback();
  mobileVoiceMode = false;
  mobileTranscriptionInFlight = false;
  mobileReplyUntil = 0;
  mobileVoiceInteractionId = '';
  send({ type: 'voice:mode', enabled: false, activationId: mobileVoiceActivationId });
  mobileVoiceActivationId = '';
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
document.querySelector('#mobile-settings-button').addEventListener('click', () => {
  setDrawer(false);
  mobileSettingsBackdrop.hidden = false;
});
document.querySelector('#mobile-new-group').addEventListener('click', () => openMobileCreate('group'));
document.querySelector('#mobile-new-session').addEventListener('click', () => openMobileCreate('session'));
document.querySelector('#mobile-create-close').addEventListener('click', closeMobileCreate);
document.querySelector('#mobile-create-cancel').addEventListener('click', closeMobileCreate);
mobileCreateBackdrop.addEventListener('click', (event) => {
  if (event.target === mobileCreateBackdrop) closeMobileCreate();
});
function resetPendingMobileCreate(status = '') {
  window.clearTimeout(pendingMobileCreateTimer);
  pendingMobileCreateTimer = null;
  if (!pendingMobileCreateRequestId) return;
  pendingMobileCreateRequestId = '';
  mobileCreateSubmit.disabled = false;
  document.querySelector('#mobile-create-status').textContent = status;
}

mobileCreateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (pendingMobileCreateRequestId) return;
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const payload = {
    type: 'mobile:create',
    requestId,
    kind: mobileCreateKind,
    groupId: mobileCreateGroup.value,
    groupName: mobileCreateGroupName.value,
    name: mobileCreateName.value,
    cwd: mobileCreateCwd.value
  };
  mobileCreateSubmit.disabled = true;
  document.querySelector('#mobile-create-status').textContent = 'Creating…';
  if (send(payload)) {
    pendingMobileCreateRequestId = requestId;
    pendingMobileCreateTimer = window.setTimeout(() => {
      resetPendingMobileCreate('Creation timed out. Please try again.');
    }, 15_000);
  } else {
    mobileCreateSubmit.disabled = false;
    document.querySelector('#mobile-create-status').textContent = 'Connect to SideTerm first.';
  }
});
document.querySelector('#mobile-settings-close').addEventListener('click', () => { mobileSettingsBackdrop.hidden = true; });
document.querySelector('#mobile-tts-speed').addEventListener('input', (event) => {
  document.querySelector('#mobile-tts-speed-value').textContent = `${Number(event.target.value).toFixed(2)}×`;
});
mobileSettingsBackdrop.addEventListener('click', (event) => {
  if (event.target === mobileSettingsBackdrop) mobileSettingsBackdrop.hidden = true;
});
mobileSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector('#mobile-settings-status').textContent = 'Saving…';
  send({
    type: 'mobile:settings:update',
    settings: {
      wakeWord: document.querySelector('#mobile-wake-word').value,
      ttsVoice: document.querySelector('#mobile-tts-voice').value,
      ttsSpeed: Number(document.querySelector('#mobile-tts-speed').value)
    }
  });
});
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
  const sessionId = activeId;
  if (!SideTermMobileSubmit.submitTerminalInput({
    value,
    send: (data) => send({ type: 'input', id: sessionId, data })
  })) return;
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
