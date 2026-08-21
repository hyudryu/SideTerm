export function releaseStaleMouseDrag(target, MouseEventConstructor = globalThis.MouseEvent) {
  if (!target?.dispatchEvent || typeof MouseEventConstructor !== 'function') return false;
  target.dispatchEvent(new MouseEventConstructor('mouseup', {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 0
  }));
  return true;
}
