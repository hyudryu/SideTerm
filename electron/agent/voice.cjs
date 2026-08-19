const VOICE_MODE_INSTRUCTION = [
  'Voice mode is enabled and your reply will be spoken out loud.',
  'Talk the way a friendly person actually talks: casual, conversational, everyday words, and contractions like "it\'s", "that\'s", "you\'re".',
  'Answer as natural spoken dialogue in one or two short sentences and no more than 35 words.',
  'Give only the basic assistant summary and the most useful next step or question.',
  'Do not use Markdown, bullets, headings, code, commit hashes, exhaustive change lists, or parenthetical detail unless the user explicitly asks for them.'
].join(' ');

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
  'Voice mode is active: the user\'s spoken request is the approval.',
  'request_terminal_input executes immediately and reports back what happened, so act first, then say what you did in one short sentence.',
  'Never tell the user to click Approve or wait for a confirmation card.',
  'Only pause to double-check genuinely irreversible or destructive commands (deletes, force pushes, published writes).'
].join(' ');

module.exports = { VOICE_MODE_INSTRUCTION, VOICE_EXECUTION_INSTRUCTION, speechSummary };
