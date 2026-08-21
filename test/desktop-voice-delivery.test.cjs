const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('desktop presentation waits for renderer playback acknowledgement', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /pendingDesktopPresentations\.set\(presentationId/);
  assert.match(main, /ipcMain\.on\('agent:voice-presented'/);
  assert.match(preload, /reportAgentVoicePresentation/);
  assert.match(renderer, /await queueAgentSpeech/);
  assert.match(renderer, /reportAgentVoicePresentation\(presentationId, delivered\)/);
});

test('renderer reload resets desktop activation and cancellation stays silent', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /webContents\.on\('did-start-loading', resetDesktopVoiceActivation\)/);
  assert.match(main, /webContents\.on\('render-process-gone', resetDesktopVoiceActivation\)/);
  assert.match(main, /if \(error\?\.name === 'AbortError' && activation\.taskId\) throw error/);
});
