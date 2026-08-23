const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('cloud STT status exposes actionable provider configuration errors', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /const configurationError = String\(status\.sttConfigurationError \|\| ''\)\.trim\(\)/);
  assert.match(renderer, /Needs setup · CLOUD — \$\{status\.sttProviderName\}.*\$\{configurationError\}/);
  assert.match(renderer, /const detail = configurationError \|\| installError/);
  assert.match(renderer, /stt\.title = detail/);
  assert.match(renderer, /classList\.toggle\('install-error', Boolean\(detail\) && !status\.sttInstalling && !status\.sttQueued\)/);
});
