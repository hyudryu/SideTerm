const KNOWN_CONFUSIONS = new Map([
  ['obrigado', 'Okay, thank you'],
  ['side term', 'SideTerm'],
  ['side turn', 'SideTerm'],
  ['cold x', 'Codex'],
  ['cod acts', 'Codex'],
  ['parakeets', 'Parakeet']
]);

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function editDistance(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[b.length];
}

function closestVocabularyTerm(text, vocabulary = []) {
  const words = normalize(text).split(' ').filter(Boolean);
  let best = null;
  for (const term of vocabulary) {
    const normalizedTerm = normalize(term);
    if (normalizedTerm.length < 4 || normalize(text).includes(normalizedTerm)) continue;
    const width = normalizedTerm.split(' ').length;
    for (let index = 0; index < words.length; index += 1) {
      const heard = words.slice(index, index + width).join(' ');
      if (!heard) continue;
      const distance = editDistance(heard, normalizedTerm);
      const threshold = Math.max(1, Math.min(3, Math.floor(normalizedTerm.length * 0.3)));
      if (distance <= threshold && (!best || distance < best.distance)) best = { term: String(term), heard, distance };
    }
  }
  return best;
}

function transcriptClarification(text, vocabulary = [], options = {}) {
  const normalized = normalize(text);
  const known = KNOWN_CONFUSIONS.get(normalized);
  const closest = closestVocabularyTerm(text, vocabulary);
  const lowConfidence = Number.isFinite(options.confidence) && options.confidence < 0.55;
  const correctedVocabulary = closest
    ? String(text).replace(new RegExp(`\\b${closest.heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), closest.term)
    : '';
  const suggestedText = known || correctedVocabulary || '';
  if (!suggestedText && !lowConfidence) return null;
  const prompt = suggestedText
    ? `I might've heard that wrong—did you mean “${suggestedText}”?`
    : 'I might’ve heard that wrong—what did you mean?';
  return { originalText: String(text), suggestedText, prompt, reason: known ? 'known-confusion' : closest ? 'active-vocabulary' : 'low-confidence' };
}

module.exports = { closestVocabularyTerm, editDistance, transcriptClarification };
