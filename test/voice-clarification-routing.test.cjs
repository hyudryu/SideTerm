const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('voice clarification replies stay bound to their own interaction without duplicate desktop speech', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(main, /desktopSpeechPresented: supervisorVoiceMode/);
  assert.match(main, /clarification: \{ \.\.\.clarification, interactionId: interaction\.id \}/);
  assert.match(main, /interactionId \|\| \(spokenRequest \? '' : state\.activeInteractionId\)/);
  assert.match(desktop, /voiceReplyInteractionId = transcript\.clarification\.interactionId/);
  assert.match(desktop, /submitAgentChat\(transcript\.text, \{ spokenRequest: true, interactionId \}\)/);
  assert.match(desktop, /if \(!replyWindowActive\) voiceReplyInteractionId = ''/);
  assert.match(desktop, /interactionId = replyWindowActive \? voiceReplyInteractionId : ''/);
  assert.match(mobile, /if \(!replyWindowActive\) mobileVoiceInteractionId = ''/);
  assert.match(mobile, /interactionId: replyWindowActive \? mobileVoiceInteractionId : ''/);
});
