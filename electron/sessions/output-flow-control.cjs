const DEFAULT_HIGH_WATER_BYTES = 512 * 1024;
const DEFAULT_LOW_WATER_BYTES = 128 * 1024;

function createOutputFlowControl(processHandle, {
  highWaterBytes = DEFAULT_HIGH_WATER_BYTES,
  lowWaterBytes = DEFAULT_LOW_WATER_BYTES
} = {}) {
  if (!processHandle || typeof processHandle.pause !== 'function' || typeof processHandle.resume !== 'function') {
    throw new TypeError('A pausable terminal process is required.');
  }
  if (!(lowWaterBytes >= 0 && highWaterBytes > lowWaterBytes)) {
    throw new RangeError('Output flow-control watermarks are invalid.');
  }

  let pendingBytes = 0;
  let paused = false;
  let disposed = false;

  const resume = () => {
    if (!paused || disposed) return;
    paused = false;
    processHandle.resume();
  };

  return {
    accept(byteLength) {
      if (disposed) return;
      pendingBytes += Math.max(0, Number(byteLength) || 0);
      if (!paused && pendingBytes >= highWaterBytes) {
        processHandle.pause();
        paused = true;
      }
    },
    acknowledge(byteLength) {
      if (disposed) return;
      pendingBytes = Math.max(0, pendingBytes - Math.max(0, Number(byteLength) || 0));
      if (pendingBytes <= lowWaterBytes) resume();
    },
    reset() {
      if (disposed) return;
      pendingBytes = 0;
      resume();
    },
    dispose() {
      disposed = true;
      pendingBytes = 0;
      paused = false;
    },
    snapshot() {
      return { pendingBytes, paused, disposed };
    }
  };
}

module.exports = {
  DEFAULT_HIGH_WATER_BYTES,
  DEFAULT_LOW_WATER_BYTES,
  createOutputFlowControl
};
