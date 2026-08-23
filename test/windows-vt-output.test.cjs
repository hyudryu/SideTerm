const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createWindowsVtOutputNormalizer,
  repairWindowsVtOutput,
  shouldRepairWindowsVtOutput
} = require('../electron/sessions/windows-vt-output.cjs');

const ESC = '\u001b';
const ARROW = '\u2190';

test('Kimi CP437 escape sequences are restored before terminal rendering', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  const broken = `${ARROW}[?2026h ${ARROW}[0m${ARROW}]8;;\u0007${ARROW}[?2026l${ARROW}[2K Welcome to Kimi Code`;
  const expected = `${ESC}[?2026h ${ESC}[0m${ESC}]8;;\u0007${ESC}[?2026l${ESC}[2K Welcome to Kimi Code`;

  assert.equal(shouldRepairWindowsVtOutput(broken), true);
  assert.equal(normalizer.push(broken), expected);
  assert.equal(normalizer.repairing, true);
});

test('Kimi sentinel split across PTY chunks still activates repair', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });

  assert.equal(normalizer.push(`prefix${ARROW}`), 'prefix');
  assert.equal(normalizer.push(`[?2026h ${ARROW}[0m ${ARROW}]0;Kimi Code\u0007`), `${ESC}[?2026h ${ESC}[0m ${ESC}]0;Kimi Code\u0007`);
});

test('isolated left-arrow prose is preserved before repair activates', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  const prose = `Move ${ARROW}[left], compare ${ARROW}[right], keep ${ARROW}[brackets], and print ${ARROW}[0m once.`;

  assert.equal(normalizer.push(prose), prose);
  assert.equal(normalizer.repairing, false);
});

test('dense ANSI-shaped output activates repair without a provider-specific label', () => {
  const broken = `${ARROW}[0m${ARROW}[2K${ARROW}]0;terminal\u0007`;
  assert.equal(shouldRepairWindowsVtOutput(broken), true);
  assert.equal(repairWindowsVtOutput(broken), `${ESC}[0m${ESC}[2K${ESC}]0;terminal\u0007`);
});

test('active repair preserves real escapes and repairs later CSI, OSC, and string terminators', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  normalizer.push(`${ARROW}[?2026h${ARROW}[0m${ARROW}[2K`);

  assert.equal(
    normalizer.push(`${ESC}[31mred${ESC}[0m ${ARROW}]8;;https://example.com${ARROW}\\link${ARROW}]8;;${ARROW}\\`),
    `${ESC}[31mred${ESC}[0m ${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\`
  );
});

test('flush preserves a trailing literal arrow', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: true });
  assert.equal(normalizer.push(`wait${ARROW}`), 'wait');
  assert.equal(normalizer.flush(), ARROW);
  assert.equal(normalizer.flush(), '');
});

test('disabled normalizer is a byte-for-byte pass-through', () => {
  const normalizer = createWindowsVtOutputNormalizer({ enabled: false });
  const broken = `${ARROW}[?2026h${ARROW}[0m${ARROW}[2K${ARROW}`;

  assert.equal(normalizer.push(broken), broken);
  assert.equal(normalizer.flush(), '');
  assert.equal(normalizer.repairing, false);
});
