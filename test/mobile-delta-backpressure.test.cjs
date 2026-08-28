const test = require('node:test');
const assert = require('node:assert/strict');
const { MOBILE_DELTA_SEND_CAP, mobileResyncState } = require('../electron/mobile/delta-backpressure.cjs');

test('mobile resync waits until the WebSocket drains below the low-water mark', () => {
  const client = {
    readyState: 1,
    sideTermSessionId: 'terminal-1',
    sideTermTerminalVisible: true,
    bufferedAmount: MOBILE_DELTA_SEND_CAP / 2 + 1
  };
  assert.equal(mobileResyncState(client), 'wait');
  client.bufferedAmount = MOBILE_DELTA_SEND_CAP / 2;
  assert.equal(mobileResyncState(client), 'ready');
});

test('mobile resync stops for closed or hidden clients', () => {
  assert.equal(mobileResyncState({ readyState: 3, sideTermSessionId: 'terminal-1' }), 'closed');
  assert.equal(mobileResyncState({
    readyState: 1,
    sideTermSessionId: 'terminal-1',
    sideTermTerminalVisible: false,
    bufferedAmount: 0
  }), 'inactive');
});
