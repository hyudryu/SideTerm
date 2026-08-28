const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../electron/mobile/terminal-reflow.js');
const { TerminalReflow, colorParams, attributeParams } = globalThis.SideTermTerminalReflow;
const { Terminal } = require('@xterm/xterm');

const mobileDirectory = path.join(__dirname, '..', 'electron', 'mobile');

function writeReflow(reflow, data) {
  return new Promise((resolve) => reflow.write(data, resolve));
}

function plainText(value) {
  return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

test('reflow rebuilds absolute-positioned screens in order', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 40, rows: 6 });
  await writeReflow(reflow, '\x1b[1;1H' + 'NAME: Codex session'.padEnd(40)
    + '\x1b[4;1H\x1b[32m✔ Working (3s)\x1b[0m'
    + '\x1b[6;1H\x1b[38;5;196merror line\x1b[0m');
  const text = reflow.serialize();
  const lines = plainText(text).split('\r\n');
  assert.equal(lines[0], 'NAME: Codex session');
  assert.equal(lines[3], '✔ Working (3s)');
  assert.equal(lines[5], 'error line');
  assert.match(text, /\x1b\[32m✔ Working \(3s\)\x1b\[0m/);
  assert.match(text, /\x1b\[38;5;196merror line\x1b\[0m/);
});

test('reflow joins soft-wrapped rows and trims trailing blank lines', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 20, rows: 6 });
  await writeReflow(reflow, 'this line is much longer than twenty columns total\r\nsecond\r\n');
  const text = reflow.serialize();
  assert.equal(plainText(text), 'this line is much longer than twenty columns total\r\nsecond');
});

test('reflow keeps raw VT line-feed semantics for un-normalized streams', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 40, rows: 6 });
  await writeReflow(reflow, 'first\ntwo');
  assert.equal(plainText(reflow.serialize()), 'first\r\n     two');
});

test('reflow repositions the model cursor at the end of serialization', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 20, rows: 4 });
  await writeReflow(reflow, 'first\r\nsecond');
  assert.ok(reflow.serialize().endsWith('\x1b[2;7H'));
});

test('reflow drops reset-only styled rows as trailing blanks', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 10, rows: 4 });
  await writeReflow(reflow, 'keep\r\n\x1b[44m   \x1b[0m');
  const text = reflow.serialize();
  assert.equal(plainText(text), 'keep');
  assert.match(text, /\x1b\[1;\d+H$/);
});

test('reflow omits wide-glyph continuation cells', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 10, rows: 2 });
  await writeReflow(reflow, '\x1b[1;1H漢X');
  assert.equal(plainText(reflow.serialize()), '漢X');
});

test('reflow preserves concealed cells as concealed', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 20, rows: 2 });
  await writeReflow(reflow, '\x1b[1;1H\x1b[8msecret\x1b[0m shown');
  assert.match(reflow.serialize(), /\x1b\[8msecret\x1b\[0m/);
});

test('reflow trims styled trailing padding before the reset', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 20, rows: 2 });
  await writeReflow(reflow, '\x1b[1;1H\x1b[41mZ          \x1b[0m');
  assert.equal(plainText(reflow.serialize()), 'Z');
  assert.match(reflow.serialize(), /Z(\x1b\[0m)?(\x1b\[\d+;\d+H)?$/);
});

test('reflow keeps boundary spaces when joining wrapped rows', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 5, rows: 4 });
  await writeReflow(reflow, 'word next');
  assert.equal(plainText(reflow.serialize()), 'word next');
});

test('reflow resizes the model grid and caps serialized history', async () => {
  const reflow = new TerminalReflow({ Terminal, cols: 10, rows: 4, maxLines: 3 });
  reflow.resize(30, 5);
  assert.equal(reflow.model.cols, 30);
  assert.equal(reflow.model.rows, 5);
  let data = '';
  for (let index = 1; index <= 10; index += 1) data += `row ${index}\r\n`;
  await writeReflow(reflow, data);
  const lines = plainText(reflow.serialize()).split('\r\n');
  assert.deepEqual(lines, ['row 8', 'row 9', 'row 10']);
});

test('reflow requires a Terminal constructor', () => {
  assert.throws(() => new TerminalReflow({}), /requires an xterm Terminal/);
});

test('color params map xterm cell modes onto SGR sequences', () => {
  const palette16 = 1 << 24;
  const palette256 = 1 << 25;
  const rgb = (1 << 24) | (1 << 25);
  assert.equal(colorParams(palette16, 2, false), '32');
  assert.equal(colorParams(palette16, 4, true), '44');
  assert.equal(colorParams(palette16, 9, false), '91');
  assert.equal(colorParams(palette16, 12, true), '104');
  assert.equal(colorParams(palette256, 196, false), '38;5;196');
  assert.equal(colorParams(rgb, 0x0a141e, false), '38;2;10;20;30');
  assert.equal(colorParams(0, 0, false), '');
});

test('attribute params collect active cell styling', () => {
  const cell = {
    isBold: () => 0,
    isDim: () => 0,
    isItalic: () => 0,
    isUnderline: () => 2,
    isInverse: () => 0,
    isStrikethrough: () => 0,
    getFgColorMode: () => 1 << 24,
    getFgColor: () => 3,
    getBgColorMode: () => 0,
    getBgColor: () => -1
  };
  assert.equal(attributeParams(cell), '4;33');
  assert.equal(attributeParams({}), '');
});

test('mobile client replays frames through the reflow model before display', () => {
  const script = fs.readFileSync(path.join(mobileDirectory, 'mobile.js'), 'utf8');
  assert.match(script, /new SideTermTerminalReflow\.TerminalReflow\(\{ Terminal, maxLines: 400 \}\)/);
  assert.match(script, /renderMobileFrame\(message\.id, message\.data, message\.cols, message\.rows, message\.source\)/);
  assert.doesNotMatch(script, /Math\.floor\(width \/ 7\.9\)/);
  assert.match(script, /fitAddon\.fit\(\)/);
});

test('mobile pages preload the fit addon and reflow helper', () => {
  const html = fs.readFileSync(path.join(mobileDirectory, 'index.html'), 'utf8');
  assert.match(html, /<script defer src="\.\/fit-addon.js"><\/script>/);
  assert.match(html, /<script defer src="\.\/terminal-reflow.js"><\/script>/);
  const serviceWorker = fs.readFileSync(path.join(mobileDirectory, 'sw.js'), 'utf8');
  assert.match(serviceWorker, /sideterm-mobile-v7/);
  assert.match(serviceWorker, /'\.\/terminal-reflow\.js'/);
  assert.match(serviceWorker, /'\.\/fit-addon\.js'/);
});

test('mobile client normalizes only capture frames, not raw streams', () => {
  const script = fs.readFileSync(path.join(mobileDirectory, 'mobile.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(script, /const payload = source === 'raw' \? String\(data \|\| ''\) : SideTermTerminalFrames\.terminalFrameText\(data\);/);
  assert.match(script, /renderMobileFrame\(message\.id, message\.data, message\.cols, message\.rows, message\.source\)/);
  assert.match(main, /source: session\.tmux && session\.tmuxSession \? 'capture' : 'raw'/);
});

test('mobile server tracks the session grid and serves the new assets', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /cols: Math\.max\(2, Math\.floor\(cols\)\),\r?\n\s*mobileRevision: 0/);
  assert.match(main, /session\.cols = Math\.max\(2, Math\.floor\(cols\)\);/);
  assert.match(main, /cols: session\.cols \|\| 100,\r?\n\s*rows: session\.rows \|\| 30/);
  assert.match(main, /require\.resolve\('@xterm\/addon-fit'\)/);
  assert.match(main, /route === 'terminal-reflow\.js'/);
  assert.match(main, /route === 'fit-addon\.js'/);
});
