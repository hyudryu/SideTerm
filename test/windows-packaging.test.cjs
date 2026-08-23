const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Windows packaging embeds and ships the SideTerm icon', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.match(packageJson.scripts['pack:win'], /electron-builder --win --dir/);
  assert.match(packageJson.scripts['pack:win'], /--config\.npmRebuild=false/);
  assert.match(packageJson.scripts['pack:win'], /--config\.electronDist=node_modules\/electron\/dist/);
  assert.match(packageJson.scripts['pack:win'], /--config\.directories\.output=release-win-packaged/);
  assert.ok(packageJson.build.files.includes('build/icon.ico'));
  assert.equal(packageJson.build.win.icon, 'build/icon.ico');
  assert.equal(packageJson.build.win.executableName, 'SideTerm');
});
