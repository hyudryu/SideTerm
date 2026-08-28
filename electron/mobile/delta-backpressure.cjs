const MOBILE_DELTA_SEND_CAP = 1_000_000;

function mobileResyncState(client, sendCap = MOBILE_DELTA_SEND_CAP) {
  if (client?.readyState !== 1) return 'closed';
  if (!client.sideTermSessionId || client.sideTermTerminalVisible === false) return 'inactive';
  if (Number(client.bufferedAmount) > sendCap / 2) return 'wait';
  return 'ready';
}

function mobileFrameDeliveryState(client, sendCap = MOBILE_DELTA_SEND_CAP) {
  if (client?.readyState !== 1 || !client.sideTermSessionId || client.sideTermTerminalVisible === false) return 'inactive';
  if (client.sideTermDeltaBacklog || Number(client.bufferedAmount) > sendCap) return 'backlog';
  return 'ready';
}

module.exports = { MOBILE_DELTA_SEND_CAP, mobileFrameDeliveryState, mobileResyncState };
