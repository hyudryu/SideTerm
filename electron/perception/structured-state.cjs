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

module.exports = { fitSessionCollection };
