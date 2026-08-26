const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mobile activity updates one unread indicator without rebuilding the session list', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  assert.match(mobile, /function markSessionUnread\(id\)[\s\S]*unread\.has\(id\)[\s\S]*classList\.add\('unread'\)/);
  assert.match(mobile, /message\.type === 'terminal:activity'[\s\S]*!unread\.has\(message\.id\)[\s\S]*markSessionUnread\(message\.id\)/);
});

test('mobile terminal pauses behind the drawer and streams incremental output when visible', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'electron', 'mobile', 'mobile.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(mobile, /function setDrawer\(open,[\s\S]*type: 'terminal:visibility'[\s\S]*visible: !open/);
  assert.match(mobile, /message\.type === 'terminal:data'[\s\S]*terminalFrames\.append\(message\.id, message\.data\)/);
  assert.match(main, /client\.sideTermTerminalVisible !== false[\s\S]*type: 'terminal:data'/);
  assert.doesNotMatch(main, /scheduleMobileTerminalFrame/);
});
