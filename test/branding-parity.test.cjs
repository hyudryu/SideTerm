const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('the in-app brand mark uses the exact generated icon artwork', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(renderer, /import sideTermIconUrl from '\.\.\/build\/icon\.svg\?url'/);
  assert.match(renderer, /<img class="brand-mark" src="\$\{sideTermIconUrl\}"/);
  assert.doesNotMatch(renderer, /&gt;ω&lt;/);
  assert.match(styles, /\.brand-mark\s*\{[^}]*object-fit:\s*contain/s);
  assert.doesNotMatch(styles, /\.brand-mark\s*\{[^}]*font-/s);
});
