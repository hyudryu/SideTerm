function endpointOrigin(value) {
  try { return new URL(String(value || '')).origin.toLowerCase(); } catch { return ''; }
}

function shouldRetainVisionCredential(previousEndpoint, nextEndpoint, replacementKey = '') {
  return Boolean(String(replacementKey || '').trim()) || endpointOrigin(previousEndpoint) === endpointOrigin(nextEndpoint);
}

module.exports = { endpointOrigin, shouldRetainVisionCredential };
