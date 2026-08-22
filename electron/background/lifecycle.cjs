function shouldHideWindowOnClose({ backgroundEnabled, quitRequested } = {}) {
  return Boolean(backgroundEnabled) && !quitRequested;
}

function shouldQuitAfterLastWindow({ platform = process.platform, backgroundEnabled, quitRequested } = {}) {
  if (quitRequested) return true;
  if (backgroundEnabled) return false;
  return platform !== 'darwin';
}

module.exports = { shouldHideWindowOnClose, shouldQuitAfterLastWindow };
