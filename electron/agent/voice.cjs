const VOICE_MODE_INSTRUCTION = [
  'Voice mode is enabled and your reply will be spoken out loud.',
  'Talk the way a friendly person actually talks: casual, conversational, everyday words, and contractions like "it\'s", "that\'s", "you\'re".',
  'Do not narrate tool use, repository inspection, research, or intermediate progress. Wait until you have the useful result or need the user\'s input.',
  'Answer as natural spoken dialogue in one or two short sentences and no more than 35 words.',
  'Give only the basic assistant summary and the most useful next step or question.',
  'Do not use Markdown, bullets, headings, code, commit hashes, exhaustive change lists, or parenthetical detail unless the user explicitly asks for them.'
].join(' ');

const VOICE_ACKNOWLEDGEMENTS = [
  'Let me check that for you.',
  'I\'ll take a look.',
  'One moment, I\'m checking.',
  'Sure, let me look into that.',
  'Got it, checking now.'
];

class VoiceAcknowledgementPicker {
  constructor({ phrases = VOICE_ACKNOWLEDGEMENTS, random = Math.random } = {}) {
    this.phrases = phrases.filter(Boolean);
    this.random = random;
    this.previous = -1;
  }

  next() {
    if (!this.phrases.length) return 'Let me check that for you.';
    if (this.phrases.length === 1) return this.phrases[0];
    const candidates = this.phrases.map((text, index) => ({ text, index }))
      .filter((item) => item.index !== this.previous);
    const selected = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    this.previous = selected.index;
    return selected.text;
  }
}

function speechSummary(value, maxWords = 40) {
  const plain = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)]\(https?:\/\/[^)]+\)/gi, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain.split(' ').filter(Boolean);
  if (words.length <= maxWords) return plain;
  const bounded = words.slice(0, maxWords).join(' ');
  const sentence = bounded.match(/^.*[.!?](?=\s|$)/)?.[0];
  return sentence || `${bounded.replace(/[,:;\s]+$/, '')}.`;
}

const VOICE_EXECUTION_INSTRUCTION = [
  'This request was transcribed directly from the user\'s speech, so that spoken request is the approval.',
  'request_terminal_input executes immediately and reports back what happened, so act first, then say what you did in one short sentence.',
  'Never tell the user to click Approve or wait for a confirmation card.',
  'Only pause to double-check genuinely irreversible or destructive commands (deletes, force pushes, published writes).'
].join(' ');

function allowsImmediateVoiceExecution(spokenRequest) {
  return spokenRequest === true;
}

function applyWakeWord(text, wakeWord, { allowWithoutWakeWord = false } = {}) {
  const transcript = String(text || '').trim();
  const phrase = String(wakeWord || '').trim();
  if (!phrase || allowWithoutWakeWord) return { ignored: false, text: transcript };
  const index = transcript.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return { ignored: true, reason: `Wake word “${phrase}” was not detected.` };
  const request = `${transcript.slice(0, index)} ${transcript.slice(index + phrase.length)}`
    .trim()
    .replace(/^[,.:;!?\s-]+/, '');
  if (!request) return { ignored: true, reason: 'Wake word detected without a request.' };
  return { ignored: false, text: request };
}

module.exports = {
  allowsImmediateVoiceExecution,
  applyWakeWord,
  VoiceAcknowledgementPicker,
  VOICE_ACKNOWLEDGEMENTS,
  VOICE_MODE_INSTRUCTION,
  VOICE_EXECUTION_INSTRUCTION,
  speechSummary
};
