function outcomeEvidence({ summary = '', context = '' } = {}) {
  const concise = String(summary || '').trim();
  if (concise) return concise;
  return String(context || '').split('\n').filter((line) => line.trim()).slice(-20).join('\n');
}

function inferEventKind(value = {}) {
  const text = outcomeEvidence(value);
  if (/\b(?:needs?|requires?|waiting for)\s+(?:your\s+)?(?:input|answer|choice|approval)\b/i.test(text)) return 'INPUT_REQUIRED';
  if (/\b(?:blocked|cannot continue|can.t proceed)\b/i.test(text)) return 'BLOCKED';
  if (/npm ERR!|\b(?:failed|failure|tests? failing|fatal error|uncaught error|error:|errors?:\s*[1-9]\d*|traceback|elifecycle|command failed|process exited with (?:code|status)\s*[1-9]\d*|exit(?:ed)? (?:code|status)\s*[1-9]\d*)\b/i.test(text)) return 'FAILED';
  return 'COMPLETED';
}

function semanticStateForEvent(kind) {
  return ({
    INPUT_REQUIRED: 'input_required', BLOCKED: 'blocked', FAILED: 'failed', COMPLETED: 'completed'
  })[String(kind || '').toUpperCase()] || 'completed';
}

module.exports = { inferEventKind, outcomeEvidence, semanticStateForEvent };
