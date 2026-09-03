const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sideTerm', {
  getWorkspaceSync: () => ipcRenderer.sendSync('workspace:get-sync'),
  getTerminalCheckpointSync: (id) => ipcRenderer.sendSync('workspace:get-terminal-checkpoint-sync', id),
  saveWorkspace: (raw) => ipcRenderer.invoke('workspace:save', raw),
  saveTerminalCheckpoint: (checkpoint) => ipcRenderer.invoke('workspace:save-terminal-checkpoint', checkpoint),
  pruneTerminalCheckpoints: (activeIds) => ipcRenderer.invoke('workspace:prune-terminal-checkpoints', activeIds),
  createSession: (options) => ipcRenderer.invoke('terminal:create', options),
  markRendererReady: (id) => ipcRenderer.invoke('terminal:renderer-ready', id),
  write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  scroll: (id, amount) => ipcRenderer.send('terminal:scroll', { id, amount }),
  armGithubPush: (id, details) => ipcRenderer.send('github:push-armed', { id, details }),
  close: (id) => ipcRenderer.invoke('terminal:close', id),
  getSessionState: (id) => ipcRenderer.invoke('terminal:get-state', id),
  onData: (callback) => subscribe('terminal:data', callback),
  acknowledgeData: (id, byteLength, replayClaimToken = '', replayDeliveryToken = '', rendererDataDeliveryToken = '', exitClaimToken = '', exitDeliveryToken = '') => ipcRenderer.send('terminal:data-ack', {
    id, byteLength, replayClaimToken, replayDeliveryToken, rendererDataDeliveryToken,
    exitClaimToken, exitDeliveryToken
  }),
  onRemoteInput: (callback) => subscribe('terminal:remote-input', callback),
  onExit: (callback) => subscribe('terminal:exit', callback),
  acknowledgeExit: (id, exitClaimToken = '', exitDeliveryToken = '') => ipcRenderer.send('terminal:exit-ack', {
    id, exitClaimToken, exitDeliveryToken
  }),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  openExternal: (targetUrl) => ipcRenderer.invoke('shell:open-external', targetUrl),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  testAiSettings: () => ipcRenderer.invoke('settings:test-ai'),
  summarizeSession: (payload) => ipcRenderer.invoke('ai:summarize-session', payload),
  getMobileInfo: () => ipcRenderer.invoke('mobile:get-info'),
  startMobile: () => ipcRenderer.invoke('mobile:start'),
  stopMobile: () => ipcRenderer.invoke('mobile:stop'),
  getTailscaleHttpsStatus: () => ipcRenderer.invoke('mobile:tailscale-https-status'),
  enableTailscaleHttps: () => ipcRenderer.invoke('mobile:enable-tailscale-https'),
  updateMobileWorkspace: (workspace) => ipcRenderer.send('mobile:update-workspace', workspace),
  updateMobileActiveSession: (activeId) => ipcRenderer.send('mobile:update-active-session', activeId),
  getAgentState: () => ipcRenderer.invoke('agent:get-state'),
  acknowledgeSessionAttention: (sessionId, cycleId) => ipcRenderer.invoke('agent:acknowledge-session', { sessionId, cycleId }),
  chatWithAgent: (text, options = {}) => ipcRenderer.invoke('agent:chat', { text, ...options }),
  catchUpAgent: (options = {}) => ipcRenderer.invoke('agent:catch-up', options),
  confirmAgentAction: (id, approved) => ipcRenderer.invoke('agent:confirm', { id, approved }),
  reportSessionFinished: (payload) => ipcRenderer.send('agent:session-finished', payload),
  setAgentVoiceMode: (enabled) => ipcRenderer.send('agent:voice-mode', Boolean(enabled)),
  reportAgentVoicePresentation: (presentationId, delivered) => ipcRenderer.send('agent:voice-presented', {
    presentationId: String(presentationId || ''), delivered: Boolean(delivered)
  }),
  onAgentState: (callback) => subscribe('agent:state', callback),
  onAgentVoicePing: (callback) => subscribe('agent:voice-ping', callback),
  onAgentAction: (callback) => subscribe('agent:action', callback),
  resolveAgentAction: (requestId, value, error = '') => ipcRenderer.send('agent:action-result', { requestId, value, error }),
  getSpeechStatus: () => ipcRenderer.invoke('voice:get-status'),
  installSpeech: async (kind) => {
    const result = await ipcRenderer.invoke('voice:install', kind);
    if (!result?.ok) throw new Error(result?.error || 'Speech installation failed.');
    return result.status;
  },
  previewVoice: (voice, speed) => ipcRenderer.invoke('voice:preview', { voice, speed }),
  synthesizeSpeech: (text, voice, token) => ipcRenderer.invoke('voice:synthesize', { text, voice, token }),
  cancelSpeechSynthesis: (token) => ipcRenderer.invoke('voice:synthesize-cancel', { token }),
  transcribeSpeech: (bytes, mimeType, allowWithoutWakeWord = false) => ipcRenderer.invoke('voice:transcribe', {
    bytes,
    mimeType,
    allowWithoutWakeWord: Boolean(allowWithoutWakeWord)
  }),
  pauseDesktopMedia: () => ipcRenderer.invoke('voice:pause-media'),
  resumeDesktopMedia: () => ipcRenderer.invoke('voice:resume-media'),
  onSpeechStatus: (callback) => subscribe('voice:status', callback),
  onWindowWillHide: (callback) => subscribe('app:will-hide', callback)
});
