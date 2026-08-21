const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretApprovalAnswer, PendingInteractionManager, shouldConsumeInteractionAnswer } = require('../electron/supervisor/interactions.cjs');

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
  assert.equal(interpretApprovalAnswer('nope'), false);
  assert.equal(interpretApprovalAnswer('maybe after the tests'), null);
  assert.equal(shouldConsumeInteractionAnswer({ kind: 'approval' }, 'maybe after the tests'), false);
  assert.equal(shouldConsumeInteractionAnswer({ kind: 'approval' }, 'yeah'), true);
});
