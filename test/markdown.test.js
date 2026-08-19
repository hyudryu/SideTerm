import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownBlocks, tokenizeInlineMarkdown } from '../src/markdown.js';

test('Supervisor Markdown recognizes common structured blocks', () => {
  assert.deepEqual(parseMarkdownBlocks([
    '## Update', '', '- First fix', '- Second fix', '',
    '> Needs review', '', '```sh', 'npm test', '```'
  ].join('\n')), [
    { type: 'heading', level: 2, text: 'Update' },
    { type: 'unordered-list', items: ['First fix', 'Second fix'] },
    { type: 'quote', text: 'Needs review' },
    { type: 'code', language: 'sh', text: 'npm test' }
  ]);
});

test('Supervisor Markdown renders formatting while rejecting unsafe links', () => {
  assert.deepEqual(tokenizeInlineMarkdown('**Done** with `tests` — [PR](https://github.com/a/b/pull/1)'), [
    { type: 'strong', text: 'Done' },
    { type: 'text', text: ' with ' },
    { type: 'code', text: 'tests' },
    { type: 'text', text: ' — ' },
    { type: 'link', text: 'PR', url: 'https://github.com/a/b/pull/1' }
  ]);
  assert.deepEqual(tokenizeInlineMarkdown('[bad](javascript:alert(1))'), [
    { type: 'text', text: '[bad](javascript:alert(1))' }
  ]);
});
