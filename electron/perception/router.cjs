function normalizePerception(value = {}, source = 'unknown') {
  return {
    source,
    summary: String(value.summary || '').slice(0, 4000),
    visibleText: Array.isArray(value.visibleText) ? value.visibleText.map((item) => String(item).slice(0, 1000)).slice(0, 200) : [],
    controls: Array.isArray(value.controls) ? value.controls.slice(0, 200).map((control) => ({
      type: String(control?.type || '').slice(0, 100),
      label: String(control?.label || '').slice(0, 300),
      state: String(control?.state || '').slice(0, 100),
      bounds: control?.bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(control.bounds[key]))
        ? { x: control.bounds.x, y: control.bounds.y, width: control.bounds.width, height: control.bounds.height }
        : undefined
    })) : [],
    errors: Array.isArray(value.errors) ? value.errors.map((item) => String(item).slice(0, 500)).slice(0, 50) : [],
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0))
  };
}

function requiresVisualEvidence(question) {
  return /\b(?:bold|color|colour|contrast|dark|dialog|font|highlight(?:ed)?|icon|image|italic|layout|light|look(?:s|ing)?|modal|overlay|popup|popover|position|screenshot|selected|selection|style|styled|styling|theme|underline|visible|visual|red|green|blue)\b/i.test(String(question || ''));
}

function structuredStateSufficient(question, payload = {}) {
  const text = String(question || '').trim();
  if (!text || requiresVisualEvidence(text)) return false;
  if (/\bactive interaction\b/i.test(text)) return true;
  if (/(?:\b(?:supervisor|agent)\b[^?.]*\bstatus\b|\bstatus\b[^?.]*\b(?:supervisor|agent)\b)/i.test(text)) return true;
  if (/\b(?:supervisor|agent)\b/i.test(text)
    && /\b(?:busy|working|thinking|idle|error|failed)\b/i.test(text)
    && !/\b(?:terminal|output|logs?|messages?|details?|cause|seeing|show(?:ing|s|n)?)\b/i.test(text)) return true;
  if (payload.session
    && /\b(?:status|busy|working|running|idle|stopped|active|failed)\b/i.test(text)
    && !/\b(?:command|terminal|output|logs?|messages?|details?|cause|seeing|show(?:ing|s|n)?)\b/i.test(text)) return true;
  if (payload.session
    && /\b(?:names?|titles?)\b/i.test(text)
    && /\b(?:it|its|this|that|selected|current|session|terminal)\b/i.test(text)
    && !/\b(?:command|output|logs?|messages?|details?|cause|seeing|show(?:ing|s|n)?)\b/i.test(text)) return true;
  if (!/\b(?:sessions?|terminals?)\b/i.test(text)) return false;
  if (/\bcommand\b/i.test(text)) return false;
  if (/\b(?:sessions|terminals)\b/i.test(text)
    && /\b(?:list|count|how many|status|busy|working|running|idle|active|names?|titles?|summar(?:y|ies|ize[ds]?)|needs? attention)\b/i.test(text)) return true;
  return /\b(?:status|busy|working|running|idle|stopped|active|names?|titles?|summar(?:y|ies|ize[ds]?)|needs? attention)\b/i.test(text);
}

function structuredCollectionRequiresCompleteList(question) {
  const text = String(question || '');
  if (!/\b(?:sessions?|terminals?)\b/i.test(text) || /\b(?:count|how many|number of)\b/i.test(text)) return false;
  if (!/\b(?:sessions|terminals)\b/i.test(text)
    && !/\b(?:which|list|all|each|every|names|titles)\b/i.test(text)) return false;
  if (/\b(?:which|what)\b/i.test(text)
    && /\b(?:session|terminal)\b/i.test(text)
    && /\bactive\b/i.test(text)) return false;
  return /\b(?:which|what|list|all|each|every|names?|titles?|summar(?:y|ies|ize[ds]?))\b/i.test(text);
}

function structuredSessionSummaryAvailable(question, payload = {}) {
  if (!/\bsummar(?:y|ies|ize[ds]?|ise[ds]?)\b/i.test(String(question || ''))) return true;
  const requestedSession = payload.session;
  if (requestedSession) return Boolean(String(requestedSession.summary || '').trim());
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const targets = /\b(?:sessions|terminals)\b/i.test(String(question || ''))
    ? sessions
    : sessions.filter((item) => item?.active || item?.id === payload.activeSessionId);
  return targets.length > 0 && targets.every((item) => Boolean(String(item?.summary || '').trim()));
}

class PerceptionRouter {
  constructor(providers = {}) {
    this.providers = providers;
  }

  async inspect(request = {}) {
    const errors = [];
    const routes = [
      ['structured-state', this.providers.structuredState],
      ['accessibility', this.providers.accessibility],
      ['terminal-text', this.providers.terminalText],
      ['native-vision', this.providers.nativeVision],
      ['separate-vision', this.providers.separateVision]
    ];
    for (const [source, provider] of routes) {
      if (typeof provider !== 'function') continue;
      if (request.forceVision && !['native-vision', 'separate-vision'].includes(source)) continue;
      if (['native-vision', 'separate-vision'].includes(source) && !request.allowCloudVision) continue;
      try {
        const result = normalizePerception((await provider(request)) || {}, source);
        errors.push(...result.errors);
        if (result.confidence >= (request.minimumConfidence ?? 0.75)) return result;
      } catch (error) {
        errors.push(`${source}: ${String(error?.message || error || 'inspection failed').slice(0, 500)}`);
      }
    }
    return normalizePerception({
      summary: 'SideTerm could not inspect that view reliably.',
      errors: [...errors, 'No configured perception source reached the required confidence.']
    }, 'none');
  }
}

module.exports = {
  PerceptionRouter,
  normalizePerception,
  requiresVisualEvidence,
  structuredCollectionRequiresCompleteList,
  structuredSessionSummaryAvailable,
  structuredStateSufficient
};
