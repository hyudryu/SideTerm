function boundedText(value, maximum) {
  return String(value || '').trim().slice(0, maximum);
}

function parseMobileCreateSessionRequest(message, workspace = { groups: [] }) {
  const requestId = boundedText(message?.requestId, 100);
  if (!requestId) throw new Error('The mobile creation request is missing an id.');

  const kind = message?.kind === 'group' ? 'group' : 'session';
  const name = boundedText(message?.name, 64);
  const cwd = boundedText(message?.cwd, 4096);
  if (kind === 'group') {
    const groupName = boundedText(message?.groupName, 32);
    if (!groupName) throw new Error('Enter a group name.');
    return {
      requestId,
      payload: { createGroup: true, groupName, name, cwd }
    };
  }

  const groupId = boundedText(message?.groupId, 100);
  if (!workspace.groups?.some((group) => group.id === groupId)) {
    throw new Error('Choose an existing group for the new session.');
  }
  return { requestId, payload: { groupId, name, cwd } };
}

module.exports = { parseMobileCreateSessionRequest };
