const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMobileCreateSessionRequest } = require('../electron/mobile/workspace-actions.cjs');

const workspace = { groups: [{ id: 'group-one', title: 'One' }] };

test('mobile can request a named session in an existing group', () => {
  assert.deepEqual(parseMobileCreateSessionRequest({
    requestId: 'request-1', kind: 'session', groupId: 'group-one', name: 'API', cwd: ' /tmp/project '
  }, workspace), {
    requestId: 'request-1', payload: { groupId: 'group-one', name: 'API', cwd: '/tmp/project' }
  });
});

test('mobile group creation forces a new group and allows a first session name', () => {
  assert.deepEqual(parseMobileCreateSessionRequest({
    requestId: 'request-2', kind: 'group', groupName: ' Backend ', name: 'Tests'
  }, workspace), {
    requestId: 'request-2', payload: { createGroup: true, groupName: 'Backend', name: 'Tests', cwd: '' }
  });
});

test('mobile creation rejects missing groups and empty new group names', () => {
  assert.throws(() => parseMobileCreateSessionRequest({ requestId: 'one', kind: 'session', groupId: 'missing' }, workspace), /Choose an existing group/);
  assert.throws(() => parseMobileCreateSessionRequest({ requestId: 'two', kind: 'group', groupName: '  ' }, workspace), /Enter a group name/);
});
