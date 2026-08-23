const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('desktop speech pauses media one second before speaking and resumes one second after', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(renderer, /const VOICE_MEDIA_TRANSITION_MS = 1_000/);
  assert.match(renderer, /async function pauseVoiceMediaBeforeSpeech\(\)[\s\S]*pauseDesktopMedia\(\)[\s\S]*await waitForVoiceMediaTransition\(\)/);
  assert.match(renderer, /async function playSpeechAudio[\s\S]*await pauseVoiceMediaBeforeSpeech\(\)[\s\S]*await player\.play\(\)/);
  assert.match(renderer, /finishVoiceMediaAfterSpeech[\s\S]*await resumeVoiceMedia\(generation\)/);
});

test('reply windows hold paused media and release it after the reply window', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(renderer, /completed && expectingResponse[\s\S]*VOICE_REPLY_WINDOW_MS \+ VOICE_MEDIA_TRANSITION_MS/);
  assert.match(renderer, /processVoiceUtterance[\s\S]*clearVoiceMediaResumeTimer\(\)/);
  assert.match(renderer, /stopDesktopVoiceMode[\s\S]*resumeVoiceMedia\(voiceMediaGeneration, 0\)/);
});

test('Windows media control resumes only sessions SideTerm actually paused', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'electron', 'voice', 'windows-media.ps1'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(main, /runWindowsMediaControl\('pause'\)[\s\S]*pausedMediaPlayers\.add/);
  assert.match(main, /runWindowsMediaControl\('resume', sessionIds\)/);
  assert.match(script, /PlaybackStatus\.ToString\(\) -ne 'Playing'[\s\S]*TryPauseAsync/);
  assert.match(script, /\$requested -notcontains \$session\.SourceAppUserModelId[\s\S]*PlaybackStatus\.ToString\(\) -ne 'Paused'[\s\S]*TryPlayAsync/);
  assert.ok(pkg.build.asarUnpack.includes('electron/voice/windows-media.ps1'));
});
