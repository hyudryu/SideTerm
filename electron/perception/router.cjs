function normalizePerception(value = {}, source = 'unknown') {
  return {
    source,
    summary: String(value.summary || '').slice(0, 4000),
    visibleText: Array.isArray(value.visibleText) ? value.visibleText.map(String).slice(0, 200) : [],
    controls: Array.isArray(value.controls) ? value.controls.slice(0, 200).map((control) => ({
      type: String(control?.type || '').slice(0, 100),
      label: String(control?.label || '').slice(0, 300),
      state: String(control?.state || '').slice(0, 100),
      bounds: control?.bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(control.bounds[key]))
        ? { x: control.bounds.x, y: control.bounds.y, width: control.bounds.width, height: control.bounds.height }
        : undefined
    })) : [],
    errors: Array.isArray(value.errors) ? value.errors.map(String).slice(0, 50) : [],
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0))
  };
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

module.exports = { PerceptionRouter, normalizePerception };
