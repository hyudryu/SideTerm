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

module.exports = { composeSubmittedInput, sendSubmittedInput };
