const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const electronMain = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

test('low GPU mode is an explicit software-rendering fallback', () => {
  assert.match(electronMain, /lowGpuMode: false/);
  assert.match(electronMain, /if \(readSettingsRecord\(\)\.lowGpuMode\) app\.disableHardwareAcceleration\(\)/);
  assert.match(electronMain, /lowGpuMode: typeof update\.lowGpuMode === 'boolean' \? update\.lowGpuMode : current\.lowGpuMode/);
  assert.match(renderer, /<input id="low-gpu-mode" type="checkbox">/);
  assert.match(renderer, /Restart SideTerm to apply Low GPU mode/);
});

test('terminal output is acknowledged after xterm finishes parsing it', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.match(electronMain, /rendererFlow: createOutputFlowControl\(processHandle\)/);
  assert.match(electronMain, /ipcMain\.on\('terminal:data-ack'/);
  assert.match(preload, /acknowledgeData: \(id, byteLength, replayClaimToken = '', replayDeliveryToken = ''\)/);
  assert.match(renderer, /session\.terminal\.write\(data, \(\) => \{[\s\S]*?api\.acknowledgeData\(id, byteLength, replayClaimToken, replayDeliveryToken\)/);
});

test('background compositor work is throttled except while desktop voice is listening', () => {
  assert.match(electronMain, /backgroundThrottling: true/);
  assert.doesNotMatch(electronMain, /backgroundThrottling: false/);
  assert.match(electronMain, /event\.sender\.setBackgroundThrottling\(!supervisorVoiceMode\)/);
  assert.match(electronMain, /function resetDesktopVoiceActivation\(\)[\s\S]*setMainWindowBackgroundThrottling\(true\)/);
  assert.match(renderer, /voiceMonitorTimer = window\.setInterval\(monitor, 33\)/);
  assert.doesNotMatch(renderer, /voiceMonitorFrame = requestAnimationFrame\(monitor\)/);
});

test('terminals retain a bounded live buffer and only the active cursor blinks', () => {
  assert.match(renderer, /const LIVE_TERMINAL_SCROLLBACK_LINES = 3_000/);
  assert.match(renderer, /cursorBlink: false/);
  assert.match(renderer, /scrollback: LIVE_TERMINAL_SCROLLBACK_LINES/);
  assert.match(renderer, /previous\.terminal\.options\.cursorBlink = false/);
  assert.match(renderer, /next\.terminal\.options\.cursorBlink = true/);
});
