import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseStaleMouseDrag } from '../src/pointer-release.js';

test('window lifecycle cleanup dispatches a released mouse button', () => {
  const events = [];
  class FakeMouseEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }
  const target = { dispatchEvent(event) { events.push(event); } };

  assert.equal(releaseStaleMouseDrag(target, FakeMouseEvent), true);
  assert.equal(events[0].type, 'mouseup');
  assert.deepEqual(events[0].options, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 0
  });
});

test('pointer cleanup is safe before the document or MouseEvent API exists', () => {
  assert.equal(releaseStaleMouseDrag(null, null), false);
  assert.equal(releaseStaleMouseDrag({ dispatchEvent() {} }, null), false);
});
