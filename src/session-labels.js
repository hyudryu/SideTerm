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
