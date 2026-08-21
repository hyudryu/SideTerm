const assert = require('node:assert/strict');
const test = require('node:test');
const { terminalScreenshotHtml, terminalViewportText } = require('../electron/perception/terminal-screenshot.cjs');

test('terminal screenshots escape untrusted session text and remove ANSI controls', () => {
  const html = terminalScreenshotHtml('\u001b[31m<script>alert(1)</script>', '<Session>');
  assert.doesNotMatch(html, /\u001b/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;Session&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('terminal screenshots retain the newest visible terminal rows', () => {
  const lines = Array.from({ length: 50 }, (_, index) => `line-${index + 1}`);
  const viewport = terminalViewportText(lines.join('\n'));
  assert.doesNotMatch(viewport, /line-20(?:\n|$)/);
  assert.match(viewport, /^line-21\n/);
  assert.match(viewport, /line-50$/);
});
