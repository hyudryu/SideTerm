const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

test('voice mode is a persisted boolean setting with a safe default', () => {
  assert.match(main, /voiceModeEnabled: false/);
  assert.match(main, /voiceModeEnabled: parsed\.voiceModeEnabled === true/);
  assert.match(main, /voiceModeEnabled: typeof update\.voiceModeEnabled === 'boolean' \? update\.voiceModeEnabled : current\.voiceModeEnabled/);
});

test('desktop voice toggle is a checkbox switch that persists explicit user changes', () => {
  assert.match(renderer, /<input id="desktop-voice-toggle" type="checkbox">/);
  assert.match(renderer, /#desktop-voice-toggle'\)\.addEventListener\('change'/);
  assert.match(renderer, /api\.saveSettings\(\{ voiceModeEnabled: true \}\)/);
  assert.match(renderer, /api\.saveSettings\(\{ voiceModeEnabled: false \}\)/);
});

test('the saved switch state is restored on startup', () => {
  assert.match(renderer, /async function initializeApp\(\)[\s\S]*settings\.voiceModeEnabled && !desktopVoiceMode[\s\S]*await startDesktopVoiceMode\(\)/);
});

test('the switch renders as a left-right slider', () => {
  assert.match(styles, /\.voice-switch input:checked \+ \.voice-switch-slider::before \{ transform: translateX\(16px\)/);
});
