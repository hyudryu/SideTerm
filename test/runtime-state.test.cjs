const assert = require('node:assert/strict');
const test = require('node:test');
const { rememberSessionCwd } = require('../electron/sessions/runtime-state.cjs');

test('direct sessions retain their initial working directory when discovery is unavailable', () => {
  const session = { cwd: 'C:\\work\\sideterm' };
  assert.equal(rememberSessionCwd(session, '', 'C:\\Users\\markx'), 'C:\\work\\sideterm');
});

test('a discovered working directory replaces and becomes the remembered value', () => {
  const session = { cwd: '/work/old' };
  assert.equal(rememberSessionCwd(session, '/work/new', '/home/user'), '/work/new');
  assert.equal(rememberSessionCwd(session, '', '/home/user'), '/work/new');
});
