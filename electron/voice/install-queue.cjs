// Serializes speech component installs: venv creation and pip cannot run
// concurrently, so a second install request waits for the first to finish.
function createInstallQueue(install) {
  let chain = Promise.resolve();
  const pending = new Map();
  return function queueInstall(kind) {
    const existing = pending.get(kind);
    if (existing) return existing;
    const run = chain
      .then(() => install(kind))
      .finally(() => pending.delete(kind));
    pending.set(kind, run);
    chain = run.catch(() => {});
    return run;
  };
}

module.exports = { createInstallQueue };
