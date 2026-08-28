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
  assert.match(main, /webContents\.on\('render-process-gone', \(_event, details\) => \{[\s\S]*?resetDesktopVoiceActivation\(\);/);
  assert.match(main, /if \(error\?\.name === 'AbortError' && activation\.taskId\) throw error/);
  assert.match(main, /taskId,\s+priority: 2,\s+interruptible: true/);
});

test('a user voice request supersedes stale proactive speech before acknowledging it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /function beginDesktopVoiceRequest\(\)[\s\S]*desktopVoiceActivationGeneration \+= 1;[\s\S]*settleDesktopPresentations\(false\)[\s\S]*userRequest: true/);
  assert.match(main, /onAccepted: voice \? beginDesktopVoiceRequest : null/);
  assert.match(renderer, /let agentSpeechGeneration = 0/);
  assert.match(renderer, /function supersedeAgentSpeech\(\)[\s\S]*agentSpeechGeneration \+= 1;[\s\S]*interruptVoicePlayback\(\)[\s\S]*agentSpeechQueue = Promise\.resolve\(true\)/);
  assert.match(renderer, /const audio = await api\.synthesizeSpeech\(text, undefined, 'desktop-voice'\);\s*if \(generation !== agentSpeechGeneration \|\| !desktopVoiceMode\) return false;\s*const completed = await playSpeechAudio\(audio\)/);
  assert.match(renderer, /onAgentVoicePing\(async \(\{[^}]*userRequest[^}]*\}[\s\S]*if \(userRequest\) supersedeAgentSpeech\(\)/);
});

test('voice transcription latency is recorded separately from model and TTS time', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('voice:transcribe',[\s\S]*appLog\.info\('speech transcribed',[\s\S]*ms: Date\.now\(\) - startedAt/);
});
