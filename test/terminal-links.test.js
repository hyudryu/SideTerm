import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalLinkProvider, findTerminalUrls, openTerminalLink } from '../src/terminal-links.js';

test('terminal URL detection trims prose punctuation but keeps URL punctuation', () => {
  assert.deepEqual(findTerminalUrls('See https://example.com/docs?q=one,two and (https://github.com/a/b).'), [
    { text: 'https://example.com/docs?q=one,two', start: 4, end: 38 },
    { text: 'https://github.com/a/b', start: 44, end: 66 }
  ]);
});

test('terminal links open only on Ctrl+click', () => {
  const opened = [];
  let prevented = false;
  const event = {
    ctrlKey: true,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  };
  assert.equal(openTerminalLink({ ctrlKey: false }, 'https://example.com', (url) => opened.push(url)), false);
  assert.equal(openTerminalLink(event, 'https://example.com/docs', (url) => opened.push(url)), true);
  assert.deepEqual(opened, ['https://example.com/docs']);
  assert.equal(prevented, true);
  assert.equal(openTerminalLink(event, 'file:///tmp/private', (url) => opened.push(url)), false);
});

test('terminal link providers expose one-based xterm ranges', () => {
  const terminal = {
    buffer: { active: { getLine: () => ({ translateToString: () => 'go https://example.com now' }) } }
  };
  const provider = createTerminalLinkProvider(terminal, () => {});
  provider.provideLinks(7, (links) => {
    assert.equal(links[0].text, 'https://example.com');
    assert.deepEqual(links[0].range, { start: { x: 4, y: 7 }, end: { x: 22, y: 7 } });
  });
});
