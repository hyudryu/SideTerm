function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sessionDetails(id, session, { resumed = Boolean(session.resumed), reattached = false } = {}) {
  const details = {
    id,
    pid: session.processHandle.pid,
    cwd: session.cwd,
    shell: session.shell,
    resumed,
    reattached,
    persistent: Boolean(session.tmux || session.windowsHosted),
    serverScrollback: Boolean(session.tmux)
  };
  if (session.processHandle.generation) details.hostGeneration = session.processHandle.generation;
  return details;
}

function bufferRendererOutput(session, data) {
  if (!session || !data) return;
  session.rendererReplay = `${session.rendererReplay || ''}${data}`;
}

function takeRendererOutput(session) {
  const replay = String(session?.rendererReplay || '');
  if (session) session.rendererReplay = '';
  return replay;
}

function reattachSession(id, session, { cols = 100, rows = 30 } = {}) {
  const nextCols = positiveInteger(cols, 100);
  const nextRows = positiveInteger(rows, 30);
  session.cols = Math.max(2, nextCols);
  session.rows = nextRows;
  try {
    session.processHandle.resize(session.cols, session.rows);
  } catch {
    // A direct node-pty process can exit between lookup and resize. Its queued
    // exit event remains authoritative and is delivered after renderer-ready.
  }
  return sessionDetails(id, session, { reattached: true });
}

module.exports = { bufferRendererOutput, reattachSession, sessionDetails, takeRendererOutput };
