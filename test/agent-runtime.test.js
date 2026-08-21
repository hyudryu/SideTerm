import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeWithProgress, StrandsSupervisor } from '../electron/agent/runtime.js';

async function* fakeAgentStream(events, result) {
  for (const event of events) yield event;
  return result;
}

test('agent progress is emitted when a tool starts and the final result still returns', async () => {
  const finalResult = { stopReason: 'endTurn', lastMessage: { content: [{ text: 'All done.' }] } };
  const agent = {
    stream() {
      return fakeAgentStream([
        { type: 'modelStreamUpdateEvent', event: { type: 'modelMessageStartEvent' } },
        { type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: "I'm checking the latest status." } } },
        { type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: 'list_sessions' } } }
      ], finalResult);
    }
  };
  const progress = [];
  const result = await invokeWithProgress(agent, 'status', {}, (text) => progress.push(text));
  assert.deepEqual(progress, ["I'm checking the latest status."]);
  assert.equal(result, finalResult);
});

test('a batch of tool calls announces progress only once', async () => {
  const agent = {
    stream() {
      return fakeAgentStream([
        { type: 'modelStreamUpdateEvent', event: { type: 'modelMessageStartEvent' } },
        { type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Let me check both pull requests.' } } },
        { type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: 'get_github_pull_request' } } },
        { type: 'modelStreamUpdateEvent', event: { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: 'get_github_pull_request' } } }
      ], { lastMessage: { content: [] } });
    }
  };
  const progress = [];
  await invokeWithProgress(agent, 'status', {}, (text) => progress.push(text));
  assert.deepEqual(progress, ['Let me check both pull requests.']);
});

test('automatic updates discard prior model conversation state', async () => {
  let conversationalUsed = false;
  const conversationalAgent = {
    stream() {
      conversationalUsed = true;
      return fakeAgentStream([], { lastMessage: { content: [{ text: 'wrong agent' }] } });
    }
  };
  const automaticAgent = {
    messages: [{ role: 'assistant', content: [{ text: 'stale plan' }] }],
    stream() {
      assert.deepEqual(this.messages, []);
      return fakeAgentStream([], { stopReason: 'endTurn', lastMessage: { content: [{ text: 'Latest result.' }] } });
    }
  };
  const supervisor = Object.create(StrandsSupervisor.prototype);
  supervisor.configure = async () => conversationalAgent;
  supervisor.automaticAgent = automaticAgent;

  const result = await supervisor.chat('latest only', {}, '', { automatic: true });
  assert.equal(result.text, 'Latest result.');
  assert.equal(conversationalUsed, false);
});
