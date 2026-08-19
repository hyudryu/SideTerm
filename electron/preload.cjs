const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sideTerm', {
  createSession: (options) => ipcRenderer.invoke('terminal:create', options),
  write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  scroll: (id, amount) => ipcRenderer.send('terminal:scroll', { id, amount }),
  armGithubPush: (id, details) => ipcRenderer.send('github:push-armed', { id, details }),
  close: (id) => ipcRenderer.send('terminal:close', id),
  getSessionState: (id) => ipcRenderer.invoke('terminal:get-state', id),
  onData: (callback) => subscribe('terminal:data', callback),
  onRemoteInput: (callback) => subscribe('terminal:remote-input', callback),
  onExit: (callback) => subscribe('terminal:exit', callback),
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
  getAgentState: () => ipcRenderer.invoke('agent:get-state'),
  chatWithAgent: (text) => ipcRenderer.invoke('agent:chat', text),
  catchUpAgent: () => ipcRenderer.invoke('agent:catch-up'),
  confirmAgentAction: (id, approved) => ipcRenderer.invoke('agent:confirm', { id, approved }),
  reportSessionFinished: (payload) => ipcRenderer.send('agent:session-finished', payload),
  onAgentState: (callback) => subscribe('agent:state', callback),
  onAgentAction: (callback) => subscribe('agent:action', callback),
  resolveAgentAction: (requestId, value, error = '') => ipcRenderer.send('agent:action-result', { requestId, value, error }),
  getSpeechStatus: () => ipcRenderer.invoke('voice:get-status'),
  installSpeech: async (kind) => {
    const result = await ipcRenderer.invoke('voice:install', kind);
    if (!result?.ok) throw new Error(result?.error || 'Speech installation failed.');
    return result.status;
  },
  previewVoice: (voice) => ipcRenderer.invoke('voice:preview', voice),
  synthesizeSpeech: (text, voice) => ipcRenderer.invoke('voice:synthesize', { text, voice }),
  transcribeSpeech: (bytes, mimeType) => ipcRenderer.invoke('voice:transcribe', { bytes, mimeType }),
  pauseDesktopMedia: () => ipcRenderer.invoke('voice:pause-media'),
  resumeDesktopMedia: () => ipcRenderer.invoke('voice:resume-media'),
  onSpeechStatus: (callback) => subscribe('voice:status', callback)
});
