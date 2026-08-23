// Approval (or a voice command) means the input runs, not just appears in
// the prompt line. The agent schema defaults submit to true; execution
// appends Enter unless the input already ends with one.
function composeSubmittedInput({ input, submit } = {}) {
  const text = String(input || '');
  return submit !== false && !/[\r\n]$/.test(text) ? `${text}\r` : text;
}

function sendSubmittedInput({ input, write, setTimer = setTimeout, submitDelayMs = 75 } = {}) {
  if (typeof write !== 'function') throw new Error('Submitting terminal input requires a write callback.');
  const text = String(input || '').replace(/[\r\n]+$/, '');
  write(text);
  return setTimer(() => write('\r'), submitDelayMs);
}

// Sends text and its submit Enter as separate pty writes. node-pty on Windows
// swallows a line terminator fused into the same write as typed text, so the
// terminating Enter always goes out on its own.
function submitTerminalInput({ input, submit, write, setTimer = setTimeout, submitDelayMs = 75 } = {}) {
  if (typeof write !== 'function') throw new Error('Submitting terminal input requires a write callback.');
  const raw = String(input || '');
  if (submit === false) {
    write(raw);
    return null;
  }
  const trailing = /([\r\n]+)$/.exec(raw);
  const text = trailing ? raw.slice(0, raw.length - trailing[1].length) : raw;
  const terminator = trailing ? trailing[1] : '\r';
  if (text) write(text);
  return setTimer(() => write(terminator), submitDelayMs);
}

module.exports = { composeSubmittedInput, sendSubmittedInput, submitTerminalInput };
