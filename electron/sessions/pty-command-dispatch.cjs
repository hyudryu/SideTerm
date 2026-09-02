function dispatchPtyCommand(handleCommand, socket, message) {
  try {
    handleCommand(socket, message);
    return true;
  } catch {
    // A PTY may exit during a fire-and-forget command. Its exit event remains
    // authoritative; command failures must not tear down every hosted PTY.
    return false;
  }
}

module.exports = { dispatchPtyCommand };
