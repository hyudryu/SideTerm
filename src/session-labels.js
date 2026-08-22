export function sessionDisplayLabels(session, aiEnabled) {
  const aiLabelActive = Boolean(aiEnabled && session?.summary);
  if (session?.manualTitle) {
    return {
      aiLabelActive,
      primary: session.title,
      secondary: session.summary || ''
    };
  }
  if (!aiLabelActive) {
    return { aiLabelActive: false, primary: session?.title || 'Terminal', secondary: '' };
  }

  const agent = String(session.agent || '').trim();
  const generatedName = String(session.displayName || '').trim();
  const summary = String(session.summary || '').trim();
  const usefulGeneratedName = generatedName && generatedName.toLowerCase() !== agent.toLowerCase()
    ? generatedName
    : summary;
  return {
    aiLabelActive: true,
    primary: usefulGeneratedName || agent || 'Terminal',
    secondary: usefulGeneratedName === summary ? agent : summary
  };
}

export function compactLastResponseAge(lastResponseAt, now = Date.now()) {
  const timestamp = Number(lastResponseAt);
  const currentTime = Number(now);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8.64e15 || !Number.isFinite(currentTime)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((currentTime - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  if (elapsedSeconds < 60 * 60) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (60 * 60))}h`;
  return `${Math.floor(elapsedSeconds / (24 * 60 * 60))}d`;
}
