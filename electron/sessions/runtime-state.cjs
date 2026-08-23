function rememberSessionCwd(session, discoveredCwd, fallbackCwd) {
  if (!session || typeof session !== 'object') return String(fallbackCwd || '');
  const discovered = String(discoveredCwd || '').trim();
  if (discovered) session.cwd = discovered;
  return String(session.cwd || fallbackCwd || '');
}

module.exports = { rememberSessionCwd };
