const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_CHECKPOINT_BYTES = 40 * 1024 * 1024;

function normalizeCheckpoint(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || typeof value.terminalState !== 'string' || !value.terminalState
    || typeof value.hostGeneration !== 'string' || !value.hostGeneration
    || value.hostGeneration.length > 100
    || !Number.isSafeInteger(value.durableOutputRevision) || value.durableOutputRevision < 0) return null;
  return {
    version: 1,
    id: value.id,
    terminalState: value.terminalState,
    mobileTerminalState: typeof value.mobileTerminalState === 'string'
      ? value.mobileTerminalState
      : '',
    terminalStateCols: Number.isInteger(value.terminalStateCols)
      ? Math.min(1_000, Math.max(2, value.terminalStateCols))
      : 80,
    terminalStateRows: Number.isInteger(value.terminalStateRows)
      ? Math.min(500, Math.max(1, value.terminalStateRows))
      : 24,
    hostGeneration: value.hostGeneration,
    durableOutputRevision: value.durableOutputRevision
  };
}

function checkpointFilename(id) {
  return `${crypto.createHash('sha256').update(id).digest('hex')}.json`;
}

function createTerminalCheckpointStore({
  directory, maximumBytes = MAX_CHECKPOINT_BYTES, beforeCommit = null
}) {
  if (!path.isAbsolute(directory)) throw new Error('Terminal checkpoint directory must be absolute.');
  const checkpointPath = (id) => path.join(directory, checkpointFilename(id));

  return {
    read(id) {
      if (typeof id !== 'string' || !id || id.length > 200) return null;
      try {
        const name = checkpointFilename(id);
        const filename = checkpointPath(id);
        if (fs.statSync(filename).size > maximumBytes) return null;
        const checkpoint = normalizeCheckpoint(JSON.parse(fs.readFileSync(filename, 'utf8')));
        return checkpoint && checkpoint.id === id && checkpointFilename(checkpoint.id) === name
          ? checkpoint
          : null;
      } catch {
        // A corrupt sidecar must not prevent this terminal session from restoring.
        return null;
      }
    },

    prune(activeIds = []) {
      const retainedNames = new Set((Array.isArray(activeIds) ? activeIds : [])
        .filter((id) => typeof id === 'string' && id && id.length <= 200)
        .map(checkpointFilename));
      let directoryHandle;
      try {
        directoryHandle = fs.opendirSync(directory);
      } catch {
        return;
      }
      try {
        let entry;
        while ((entry = directoryHandle.readSync()) !== null) {
          if (!entry.isFile()) continue;
          const checkpoint = /^[a-f0-9]{64}\.json$/.test(entry.name);
          const temporary = /^[a-f0-9]{64}\.json\.[a-f0-9-]+\.tmp$/.test(entry.name);
          if (temporary || (checkpoint && !retainedNames.has(entry.name))) {
            try { fs.unlinkSync(path.join(directory, entry.name)); } catch {}
          }
        }
      } finally {
        directoryHandle.closeSync();
      }
    },

    save(value) {
      const checkpoint = normalizeCheckpoint(value);
      if (!checkpoint) throw new Error('Terminal checkpoint has an invalid shape.');
      const serialized = `${JSON.stringify(checkpoint)}\n`;
      if (Buffer.byteLength(serialized) > maximumBytes) {
        throw new Error('Terminal checkpoint is too large.');
      }
      fs.mkdirSync(directory, { recursive: true });
      const target = checkpointPath(checkpoint.id);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, serialized, { mode: 0o600 });
        beforeCommit?.(checkpoint, temporary, target);
        fs.renameSync(temporary, target);
        fs.chmodSync(target, 0o600);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
      }
      return checkpoint;
    }
  };
}

module.exports = {
  MAX_CHECKPOINT_BYTES,
  createTerminalCheckpointStore,
  normalizeCheckpoint
};
