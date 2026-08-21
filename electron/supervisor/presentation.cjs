function deterministicPresentation(event = {}) {
  const name = String(event.friendlyName || event.title || 'A SideTerm session').trim();
  const summary = String(event.presentation?.shortText || event.summary || '').trim();
  switch (event.kind) {
    case 'INPUT_REQUIRED': return summary || `${name} needs your input.`;
    case 'BLOCKED': return summary || `${name} is blocked and needs your help.`;
    case 'FAILED': return summary || `${name} failed. I can help inspect what happened.`;
    case 'REVIEW_RECEIVED': return summary || `${name} received new review feedback.`;
    case 'CI_FAILED': return summary || `${name} has a failing check.`;
    case 'WATCH_CONDITION_MET': return summary || `${name} reached the condition you asked me to watch for.`;
    case 'COMPLETED': return summary ? `${name} finished. ${summary}` : `${name} finished.`;
    case 'CI_PASSED': return summary || `${name} checks passed.`;
    default: return summary;
  }
}

class PresentationCoordinator {
  constructor(options = {}) {
    this.surfaces = new Map();
    this.onMetric = options.onMetric || (() => {});
  }

  registerSurface(id, present) {
    if (!id || typeof present !== 'function') throw new TypeError('Presentation surfaces require an id and callback.');
    const surface = { present, pending: Promise.resolve() };
    this.surfaces.set(String(id), surface);
    return () => this.surfaces.delete(String(id));
  }

  present(text, options = {}) {
    const content = String(text || '').trim();
    if (!content) return Promise.resolve([]);
    const targets = options.targets ? new Set(options.targets.map(String)) : null;
    const jobs = [];
    for (const [id, surface] of this.surfaces) {
      if (targets && !targets.has(id)) continue;
      const queuedAt = Date.now();
      surface.pending = surface.pending.catch(() => false).then(async () => {
        if (typeof options.isCurrent === 'function' && !options.isCurrent(id)) return false;
        this.onMetric({ type: 'presentation-start', surfaceId: id, queuedAt, startedAt: Date.now(), eventId: options.eventId || '' });
        return surface.present(content, options);
      });
      jobs.push(surface.pending);
    }
    return Promise.allSettled(jobs);
  }
}

module.exports = { PresentationCoordinator, deterministicPresentation };
