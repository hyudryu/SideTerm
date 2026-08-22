function endpointOrigin(value) {
  try { return new URL(String(value || '')).origin.toLowerCase(); } catch { return ''; }
}

function shouldRetainVisionCredential(previousEndpoint, nextEndpoint, replacementKey = '') {
  return Boolean(String(replacementKey || '').trim()) || endpointOrigin(previousEndpoint) === endpointOrigin(nextEndpoint);
}

function visionEndpointConfigurationError(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint) return '';
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Vision endpoint must be a valid URL.';
  }
  if (url.protocol === 'https:') return '';
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
  if (url.protocol === 'http:' && loopback) return '';
  return 'Remote vision endpoints must use HTTPS; HTTP is allowed only for an explicit loopback address.';
}

module.exports = { endpointOrigin, shouldRetainVisionCredential, visionEndpointConfigurationError };
