export const TERMINAL_GROW_REFIT_THRESHOLD_PX = 20;

function finiteSize(size) {
  return Number.isFinite(size?.width) && Number.isFinite(size?.height);
}

export function shouldRefitTerminal(lastFitSize, previousObservedSize, nextSize) {
  if (!finiteSize(lastFitSize) || !finiteSize(previousObservedSize) || !finiteSize(nextSize)) return true;
  if (nextSize.height !== previousObservedSize.height) return true;

  // A narrower terminal means the auto-width sidebar expanded, so refit even
  // for one pixel to prevent clipping. When the sidebar shrinks, wait until the
  // terminal has gained 20 pixels in total since its last actual fit.
  if (nextSize.width < previousObservedSize.width) return true;
  return nextSize.width - lastFitSize.width >= TERMINAL_GROW_REFIT_THRESHOLD_PX;
}
