function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sessionDetails(id, session, { resumed = Boolean(session.resumed), reattached = false } = {}) {
  return {
    id,
    pid: session.processHandle.pid,
    cwd: session.cwd,
    shell: session.shell,
    resumed,
    reattached,
    persistent: Boolean(session.tmux || session.windowsHosted),
    serverScrollback: Boolean(session.tmux)
  };
}

function reattachSession(id, session, { cols = 100, rows = 30 } = {}) {
  const nextCols = positiveInteger(cols, 100);
  const nextRows = positiveInteger(rows, 30);
  session.processHandle.resize(Math.max(2, nextCols), nextRows);
  session.rows = nextRows;
  return sessionDetails(id, session, { reattached: true });
}

module.exports = { reattachSession, sessionDetails };
