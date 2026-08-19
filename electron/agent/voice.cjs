const VOICE_MODE_INSTRUCTION = [
  'Voice mode is enabled.',
  'Answer as natural spoken dialogue in one or two short sentences and no more than 35 words.',
  'Give only the basic assistant summary and the most useful next step or question.',
  'Do not use Markdown, bullets, headings, commit hashes, exhaustive change lists, or parenthetical detail unless the user explicitly asks for them.'
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

module.exports = { VOICE_MODE_INSTRUCTION, speechSummary };
