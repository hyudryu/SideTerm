const test = require('node:test');
const assert = require('node:assert/strict');
const { MOBILE_DELTA_SEND_CAP, mobileFrameDeliveryState, mobileResyncState } = require('../electron/mobile/delta-backpressure.cjs');

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

test('mobile frames stop while the socket or a prior frame is backlogged', () => {
  const client = {
    readyState: 1,
    sideTermSessionId: 'terminal-1',
    sideTermTerminalVisible: true,
    bufferedAmount: MOBILE_DELTA_SEND_CAP + 1
  };
  assert.equal(mobileFrameDeliveryState(client), 'backlog');
  client.bufferedAmount = 0;
  client.sideTermDeltaBacklog = true;
  assert.equal(mobileFrameDeliveryState(client), 'backlog');
  client.sideTermDeltaBacklog = false;
  assert.equal(mobileFrameDeliveryState(client), 'ready');
});
