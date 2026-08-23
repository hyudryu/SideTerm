const AGENT_COMMANDS = /^(?:codex|hermes|claude|gemini|kimi)(?:\.js)?$/i;

const ANSI_PATTERN = /\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function isIdleCodingAgentPrompt({ agent, busy, currentCommand, screen, trustAgentMetadata = false } = {}) {
  if (busy || !/^(?:Codex|Hermes|Claude|Gemini|Kimi)$/i.test(String(agent || '').trim())) return false;
  const command = String(currentCommand || '').trim().split('/').at(-1);
  const visible = String(screen || '').replace(ANSI_PATTERN, '').slice(-12_000);
  const branded = /(?:OpenAI\s+Codex|Claude\s+Code|Gemini\s+CLI|Hermes|Kimi\s+Code|⚕)/i.test(visible);
  const hasPrompt = /(?:^|\n)\s*(?:[│┃╎╽]\s*)?(?:⚕\s*)?[›❯>]\s*[^\n]{0,240}$/m.test(visible);
  const visiblyWorking = /(?:Working\s*\(|esc to interrupt|Ctrl\+C cancel)/i.test(visible);
  return (AGENT_COMMANDS.test(command) || branded || trustAgentMetadata) && hasPrompt && !visiblyWorking;
}

module.exports = { isIdleCodingAgentPrompt };
