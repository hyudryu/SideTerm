const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('visual inspection captures the styled live terminal and preserves fallback routing', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /'prepare-session-chrome-capture' : 'prepare-terminal-capture'/);
  assert.match(main, /try \{[\s\S]*requiresSessionChrome\(question\) \? 'prepare-session-chrome-capture' : 'prepare-terminal-capture'[\s\S]*finally \{[\s\S]*requestRendererAction\('restore-terminal-capture'/);
  assert.match(main, /webContents\.capturePage\(bounds\)/);
  assert.doesNotMatch(main, /forceVision:\s*true/);
  assert.match(renderer, /type === 'prepare-terminal-capture'[\s\S]*session\.pane\.classList\.add\('active'\)/);
  assert.match(renderer, /session\.fit\.fit\(\);[\s\S]*await waitForTerminalCaptureRepaint\(\)/);
  assert.match(renderer, /window\.setTimeout\(done, 80\)/);
});

test('retained stopped sessions remain eligible for structured and visual inspection', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.doesNotMatch(main, /sessionId && !session\) throw new Error\('That session is stopped/);
  assert.match(main, /const screenshot = async \(\) => \{[\s\S]*if \(sessionId\) \{[\s\S]*prepare-terminal-capture/);
});

test('targeted session chrome questions capture only the requested sidebar item', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /requiresSessionChrome\(question\) \? 'prepare-session-chrome-capture' : 'prepare-terminal-capture'/);
  assert.match(renderer, /type === 'prepare-session-chrome-capture'[\s\S]*session\.item\.getBoundingClientRect\(\)/);
  assert.match(renderer, /session\.item\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(main, /requiresSessionChrome\(question\)[\s\S]{0,200}'prepare-window-capture'/);
});

test('terminal capture hides credential-bearing and nonterminal overlays', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /querySelectorAll\('\.settings-backdrop, \.link-popover, \.toast-region'\)/);
  assert.match(renderer, /for \(const overlay of overlayStates\) overlay\.element\.hidden = true/);
  assert.match(renderer, /for \(const overlay of overlayStates\) overlay\.element\.hidden = overlay\.hidden/);
  assert.match(renderer, /querySelectorAll\('input\[type="password"\]'\)[\s\S]*credential\.element\.value = '••••••••'/);
  assert.match(renderer, /querySelectorAll\('#mobile-urls code'\)[\s\S]*'\[redacted mobile access URL\]'/);
  assert.match(renderer, /querySelectorAll\('#mobile-urls canvas'\)[\s\S]*style\.visibility = 'hidden'/);
  assert.match(renderer, /supervisorDashboard\.hidden = true/);
});

test('whole-window capture preserves observable overlays and restores masked credentials', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /requestRendererAction\('prepare-window-capture'/);
  assert.match(main, /prepare-window-capture'[\s\S]*capturePage\(\)[\s\S]*finally \{[\s\S]*restore-terminal-capture/);
  assert.match(renderer, /type === 'prepare-window-capture'[\s\S]*hideNonterminalCaptureOverlays\(\{ hideDashboard: false, preserveOverlays: true \}\)/);
  assert.match(renderer, /if \(!preserveOverlays\) \{[\s\S]*overlay\.element\.hidden = true/);
  assert.match(renderer, /credential\.element\.value = credential\.value/);
  assert.match(renderer, /mobileUrl\.element\.textContent = mobileUrl\.text/);
  assert.match(renderer, /mobileQr\.element\.style\.visibility = mobileQr\.visibility/);
});

test('session capture restores the live active session without dropping PTY output', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /sessions\.get\(activeId\)\?\.pane\.classList\.add\('active'\)/);
  assert.doesNotMatch(renderer, /for \(const pane of activePanes\) pane\.classList\.add\('active'\)/);
  assert.doesNotMatch(renderer, /captureRedrawSuppressedUntil/);
  assert.match(renderer, /api\.onData[\s\S]*recordSessionResponse\(session, data\);[\s\S]*appendSessionContext\(session, data\);[\s\S]*noteBackgroundActivity\(session, data\)/);
});

test('whole-window capture preserves the dashboard while masking sensitive overlays', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /hideNonterminalCaptureOverlays\(\{ hideDashboard = true, preserveOverlays = false \} = \{\}\)/);
  assert.match(renderer, /if \(hideDashboard\) \{[\s\S]*supervisorDashboard\.hidden = true/);
});

test('terminal fitting skips the hidden supervisor dashboard layout', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(renderer, /function fitSession\(session\) \{[\s\S]*shellElement\.classList\.contains\('supervisor-active'\)[\s\S]*terminalStack\.getClientRects\(\)\.length === 0[\s\S]*session\.fit\.fit\(\)/);
});

test('collection status inspection includes the bounded live session list', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const listedSessions = sessionId \? \[\] : collectionCandidates\.slice\(0, 200\)\.map/);
  assert.match(main, /const live = sessions\.has\(item\.id\);[\s\S]*const busy = live && Boolean\(item\.busy\)/);
  assert.match(main, /status: !live \? 'stopped' : busy \? 'running' : 'idle'/);
  assert.match(main, /needsAttention: Boolean\(item\.notified\)/);
  assert.match(main, /active: item\.id === mobileWorkspace\.activeId/);
  assert.match(main, /activeSessionId: mobileWorkspace\.activeId/);
  assert.match(main, /const activeWorkspaceSession = archivedQuery[\s\S]*workspaceSessions\.find\(\(item\) => item\.id === mobileWorkspace\.activeId\)/);
  assert.match(main, /\[activeWorkspaceSession, \.\.\.workspaceSessions\.filter/);
  assert.match(main, /fitSessionCollection\(\{[\s\S]*sessionCollection: \{[\s\S]*\.\.\.sessionCounts/);
  assert.match(main, /session: structuredSessionRecord\(\{[\s\S]*metadata,[\s\S]*live: Boolean\(session\)/);
});

test('active terminal text is used before whole-window vision', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const activeTerminal = !sessionId && mobileWorkspace\.activeId \? sessions\.get\(mobileWorkspace\.activeId\) : null/);
  assert.match(main, /const liveTerminal = session \|\| activeTerminal;[\s\S]*captureSessionScreen\(liveTerminal\)/);
});

test('capture routing keeps incomplete collection questions away from terminal text', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /requiresVisualEvidence\(question\) \|\| structuredCollectionRequiresCompleteList\(question\) \? 0\.6 : 0\.9/);
});

test('terminal text routing preserves the newest output tail', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /summary: text\.slice\(-4000\)/);
  assert.match(main, /slice\(-200\)\.map\(\(line\) => line\.slice\(-1000\)\)/);
});

test('capture lifetime locks session activation and terminal input', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(main, /function lockTerminalCaptureInteraction\(\) \{[\s\S]*classList\.add\('capture-locked'\)[\s\S]*classList\.remove\('capture-locked'\)/);
  assert.match(main, /function activateSession\(id\) \{\s*if \(terminalCaptureRestore\) return;/);
  assert.match(main, /terminal\.onData\(\(data\) => \{[\s\S]*if \(terminalCaptureRestore && userInput\) return;[\s\S]*api\.write\(id, data\)/);
  assert.match(main, /attachCustomKeyEventHandler\(\(event\) => \{[\s\S]*if \(terminalCaptureRestore\) return false;/);
  assert.match(main, /window\.addEventListener\('keydown', \(event\) => \{\s*if \(terminalCaptureRestore\)/);
  assert.match(styles, /\.app-shell\.capture-locked \{ pointer-events: none; \}/);
});

test('capture-only fits do not resize the backing PTY', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /const terminalCaptureResizeTokens = new Map\(\)/);
  assert.match(main, /const originalDimensions = \{ cols: session\.terminal\.cols, rows: session\.terminal\.rows \}/);
  assert.match(main, /terminalCaptureResizeTokens\.set\(session\.id, resizeToken\)[\s\S]*session\.fit\.fit\(\)/);
  assert.match(main, /restoreCapturedTerminalLayout\(session\.id, resizeToken, originalDimensions, restoreInteraction\)/);
  assert.match(main, /sessionId !== activeId[\s\S]*capturedSession\.terminal\.resize\(originalDimensions\.cols, originalDimensions\.rows\)/);
  assert.match(main, /terminalCaptureResizeTokens\.delete\(sessionId\)[\s\S]*api\.resize\(sessionId, capturedSession\.terminal\.cols, capturedSession\.terminal\.rows\)/);
  assert.match(main, /terminal\.onResize\(\(\{ cols, rows \}\) => \{\s*if \(!terminalCaptureResizeTokens\.has\(id\)\) api\.resize\(id, cols, rows\)/);
});

test('active identity publishes immediately and stopped terminals retain local text routing', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.match(renderer, /function activateSession\(id\) \{[\s\S]*activeId = id;[\s\S]*updateMobileActiveSession\(activeId\);[\s\S]*schedulePersist\(\);/);
  assert.match(preload, /updateMobileActiveSession: \(activeId\) => ipcRenderer\.send\('mobile:update-active-session', activeId\)/);
  assert.match(main, /ipcMain\.on\('mobile:update-active-session'[\s\S]*mobileWorkspace = \{ \.\.\.mobileWorkspace, activeId \}/);
  assert.match(renderer, /type === 'read-terminal-text'[\s\S]*terminalHistory\(session\.terminal\)\.slice\(-20_000\)/);
  assert.match(main, /terminalText: session \|\| activeTerminal \|\| metadata \|\| activeMetadata \? async \(\) =>/);
  assert.match(main, /requestRendererAction\('read-terminal-text', \{[\s\S]*sessionId: sessionId \|\| activeMetadata\.id/);
});

test('structured state includes archives, interactions, and session groups', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /archivedQuery[\s\S]*state\.archivedSessions\.map/);
  assert.match(main, /sessionCollectionKind: archivedQuery \? 'archived' : 'workspace'/);
  assert.match(main, /activeInteraction: activeInteraction \? \{/);
  assert.match(main, /groupId,[\s\S]*group: groupNames\.get\(groupId\) \|\| 'Ungrouped'/);
  assert.match(main, /terminalText: session \|\| activeTerminal \|\| metadata \|\| activeMetadata/);
  assert.match(main, /sessionId: sessionId \|\| activeMetadata\.id/);
});

test('persisted vision upload consent fails closed unless it is boolean true', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /visionEnabled: parsed\.visionEnabled === true/);
  assert.doesNotMatch(main, /visionEnabled: Boolean\(parsed\.visionEnabled\)/);
});
