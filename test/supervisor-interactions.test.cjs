const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretApprovalAnswer, interpretConfirmationApprovalAnswer, PendingInteractionManager, shouldConsumeInteractionAnswer } = require('../electron/supervisor/interactions.cjs');

test('new events do not steal an answer from the active interaction', () => {
  const interactions = [];
  const manager = new PendingInteractionManager(interactions, { createId: (() => { let id = 0; return () => `i-${++id}`; })() });
  const first = manager.create({ kind: 'tui_selection', prompt: 'Use A or B?', priority: 0 });
  manager.create({ kind: 'supervisor_question', prompt: 'Inspect failure?', priority: 0 });
  const answered = manager.answer('Use B');
  assert.equal(answered.id, first.id);
  assert.equal(answered.answer, 'Use B');
  assert.notEqual(manager.activeInteractionId, first.id);
});

test('approval answers are explicit and colloquial without guessing ambiguous speech', () => {
  assert.equal(interpretApprovalAnswer('yeah'), true);
  assert.equal(interpretApprovalAnswer('Yes.'), true);
  assert.equal(interpretApprovalAnswer('go ahead!'), true);
  assert.equal(interpretApprovalAnswer('No, thanks.'), false);
  assert.equal(interpretApprovalAnswer('nope'), false);
  assert.equal(interpretApprovalAnswer('maybe after the tests'), null);
  assert.equal(shouldConsumeInteractionAnswer({ kind: 'approval' }, 'maybe after the tests'), false);
  assert.equal(shouldConsumeInteractionAnswer({ kind: 'approval' }, 'yeah'), true);
});

test('the Codex review handoff accepts one explicit spoken instruction', () => {
  const handoff = { source: 'codex-review-handoff' };
  assert.equal(interpretConfirmationApprovalAnswer('Okay, go ahead and fix the Codex comments.', handoff), true);
  assert.equal(interpretConfirmationApprovalAnswer('Not yet, I want to read the Codex comments.', handoff), false);
  assert.equal(interpretConfirmationApprovalAnswer('Fix the thing', handoff), null);
  assert.equal(interpretConfirmationApprovalAnswer('Okay, go ahead and fix the Codex comments.', { source: 'merge' }), null);
});

test('failed approval execution restores the same interaction for retry', () => {
  const interactions = [];
  const manager = new PendingInteractionManager(interactions, { createId: () => 'approval' });
  manager.create({ kind: 'approval', prompt: 'Post it?', state: 'awaiting_answer' });
  manager.answer('yes');
  manager.create({ id: 'later', kind: 'supervisor_question', prompt: 'Anything else?' });
  const restored = manager.restore('approval');
  assert.equal(restored.state, 'awaiting_answer');
  assert.equal(manager.activeInteractionId, 'approval');
  assert.equal(restored.answer, '');
});
