const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function functionSource(name) {
  const start = renderer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = renderer.indexOf('\nfunction ', start + 1);
  return renderer.slice(start, end < 0 ? renderer.length : end);
}

test('a suppressed activity recheck always schedules another settle pass during idle grace', () => {
  const source = functionSource('recheckSuppressedAgentBusy');
  assert.match(source, /scheduleSessionBusySettlement\(session\)/);
  assert.doesNotMatch(source, /noteSessionBusy\(session, ''\)/);
});

test('a bare agent launch retires the previous activity cycle and timer', () => {
  const retire = functionSource('retireSessionActivityCycle');
  assert.match(retire, /window\.clearTimeout\(session\.busyTimer\)/);
  assert.match(retire, /session\.busyTimer = null/);
  assert.match(retire, /session\.busy = false/);
  assert.match(retire, /session\.activityArmed = false/);
  assert.match(retire, /session\.notifyWhenIdle = false/);
  assert.match(renderer, /isShellLevelAgentLaunch\(command, visibleTerminalText\(session\.terminal\)\)/);
  assert.match(renderer, /retireSessionActivityCycle\(session, \{ suppressAutoArmUntilIdle: true \}\)/);
});

test('terminal bells cannot notify before their rendered activity frame is evaluated', () => {
  const bellHandler = renderer.match(/terminal\.onBell\(\(\) => \{[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.ok(bellHandler);
  assert.doesNotMatch(bellHandler, /markSessionNotification/);
  assert.match(renderer, /session\.terminal\.write\(data, \(\) => \{\s*noteSessionBusy\(session, data\);\s*noteBackgroundActivity\(session, data\);/);
});
