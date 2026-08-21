function fitSessionCollection(payload = {}, candidates = [], options = {}) {
  const maxChars = Math.max(500, Number(options.maxChars) || 3900);
  const includeSessions = options.includeSessions !== false;
  const total = Math.max(0, Number(payload.sessionCollection?.total) || candidates.length);
  const fitted = {
    ...payload,
    sessionCollection: {
      ...(payload.sessionCollection || {}),
      total,
      returned: 0,
      truncated: false
    },
    sessions: []
  };
  if (includeSessions) {
    for (const candidate of candidates) {
      fitted.sessions.push(candidate);
      fitted.sessionCollection.returned = fitted.sessions.length;
      fitted.sessionCollection.truncated = fitted.sessions.length < total;
      if (JSON.stringify(fitted).length <= maxChars) continue;
      fitted.sessions.pop();
      fitted.sessionCollection.returned = fitted.sessions.length;
      fitted.sessionCollection.truncated = true;
      break;
    }
    fitted.sessionCollection.truncated = fitted.sessions.length < total;
  } else {
    fitted.sessionCollection.truncated = total > 0;
  }
  const summary = JSON.stringify(fitted);
  if (summary.length > maxChars) throw new Error('Structured session metadata exceeds the perception limit.');
  return { payload: fitted, summary };
}

function structuredSessionRecord({ sessionId = '', metadata = null, live = false, indexed = null } = {}) {
  if (metadata) {
    return {
      id: String(metadata.id || sessionId),
      title: String(metadata.title || indexed?.friendlyName || sessionId || 'Terminal'),
      summary: String(metadata.summary || indexed?.currentTask || ''),
      busy: Boolean(metadata.busy),
      status: metadata.busy ? 'running' : live ? 'idle' : 'stopped',
      needsAttention: Boolean(metadata.notified)
    };
  }
  if (!live) return null;
  const status = indexed?.status === 'running' ? 'running' : 'idle';
  return {
    id: String(sessionId),
    title: String(indexed?.friendlyName || sessionId || 'Terminal'),
    summary: String(indexed?.currentTask || ''),
    busy: status === 'running',
    status,
    needsAttention: ['completed', 'input_required', 'blocked', 'failed'].includes(indexed?.semanticState)
  };
}

module.exports = { fitSessionCollection, structuredSessionRecord };
