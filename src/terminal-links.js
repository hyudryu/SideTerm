const TRAILING_PUNCTUATION = /[.,;:!?]$/;
const CLOSING_PAIRS = [[')', '('], [']', '['], ['}', '{']];

function trimTerminalUrl(value) {
  let url = String(value || '');
  while (TRAILING_PUNCTUATION.test(url)) url = url.slice(0, -1);
  for (const [closing, opening] of CLOSING_PAIRS) {
    while (url.endsWith(closing)
      && url.split(closing).length > url.split(opening).length) url = url.slice(0, -1);
  }
  return url;
}

export function findTerminalUrls(lineText) {
  const links = [];
  for (const match of String(lineText || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const text = trimTerminalUrl(match[0]);
    if (!text) continue;
    links.push({ text, start: match.index, end: match.index + text.length });
  }
  return links;
}

export function openTerminalLink(event, text, openExternal) {
  if (!event?.ctrlKey || typeof openExternal !== 'function') return false;
  let url;
  try {
    url = new URL(String(text));
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  void Promise.resolve(openExternal(url.toString())).catch(() => {});
  return true;
}

export function createTerminalLinkProvider(terminal, openExternal) {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal?.buffer?.active?.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const links = findTerminalUrls(line.translateToString(true)).map((link) => ({
        text: link.text,
        range: {
          start: { x: link.start + 1, y: bufferLineNumber },
          end: { x: link.end, y: bufferLineNumber }
        },
        activate: (event, text) => openTerminalLink(event, text, openExternal)
      }));
      callback(links.length ? links : undefined);
    }
  };
}
