const AGENT_COMMANDS = /^(?:codex|hermes|claude|gemini)(?:\.js)?$/i;

function isIdleCodingAgentPrompt({ agent, busy, currentCommand, screen } = {}) {
  if (busy || !/^(?:Codex|Hermes|Claude|Gemini)$/i.test(String(agent || '').trim())) return false;
  const command = String(currentCommand || '').trim().split('/').at(-1);
  const visible = String(screen || '').slice(-12_000);
  const branded = /(?:OpenAI\s+Codex|Claude\s+Code|Gemini\s+CLI|Hermes|⚕)/i.test(visible);
  const hasPrompt = /(?:^|\n)\s*(?:⚕\s*)?[›❯>]\s*[^\n]{0,240}$/m.test(visible);
  const visiblyWorking = /(?:Working\s*\(|esc to interrupt|Ctrl\+C cancel)/i.test(visible);
  return (AGENT_COMMANDS.test(command) || branded) && hasPrompt && !visiblyWorking;
}

module.exports = { isIdleCodingAgentPrompt };
