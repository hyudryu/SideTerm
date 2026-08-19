const BLOCK_START = /^(?:#{1,6}\s+|```|[-*+]\s+|\d+[.)]\s+|>\s?|(?:[-*_]\s*){3,})/;
const INLINE_MARKUP = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*[^*\n]+\*|_[^_\n]+_|\n)/i;

export function parseMarkdownBlocks(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^```\s*([\w.+-]*)\s*$/);
    if (fence) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1], text: content.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
      blocks.push({ type: 'separator' });
      index += 1;
      continue;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const type = ordered ? 'ordered-list' : 'unordered-list';
      const pattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(pattern);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ type, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quoted.join('\n') });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

export function tokenizeInlineMarkdown(value) {
  const tokens = [];
  let remaining = String(value || '');
  while (remaining) {
    const match = remaining.match(INLINE_MARKUP);
    if (!match) {
      tokens.push({ type: 'text', text: remaining });
      break;
    }
    if (match.index > 0) tokens.push({ type: 'text', text: remaining.slice(0, match.index) });
    const markup = match[0];
    const link = markup.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
    if (link) tokens.push({ type: 'link', text: link[1], url: link[2] });
    else if (markup.startsWith('**') || markup.startsWith('__')) tokens.push({ type: 'strong', text: markup.slice(2, -2) });
    else if (markup.startsWith('`')) tokens.push({ type: 'code', text: markup.slice(1, -1) });
    else if (markup === '\n') tokens.push({ type: 'break', text: '' });
    else tokens.push({ type: 'emphasis', text: markup.slice(1, -1) });
    remaining = remaining.slice((match.index || 0) + markup.length);
  }
  return tokens;
}

function appendInline(document, parent, value, onLink) {
  for (const token of tokenizeInlineMarkdown(value)) {
    if (token.type === 'text') parent.append(document.createTextNode(token.text));
    if (token.type === 'break') parent.append(document.createElement('br'));
    if (token.type === 'code') {
      const code = document.createElement('code');
      code.textContent = token.text;
      parent.append(code);
    }
    if (token.type === 'strong' || token.type === 'emphasis') {
      const element = document.createElement(token.type === 'strong' ? 'strong' : 'em');
      appendInline(document, element, token.text, onLink);
      parent.append(element);
    }
    if (token.type === 'link') {
      const link = document.createElement('a');
      link.href = token.url;
      link.textContent = token.text;
      link.rel = 'noreferrer noopener';
      link.target = '_blank';
      if (onLink) link.addEventListener('click', (event) => {
        event.preventDefault();
        onLink(token.url);
      });
      parent.append(link);
    }
  }
}

export function renderMarkdown(document, container, value, { onLink } = {}) {
  container.replaceChildren();
  for (const block of parseMarkdownBlocks(value)) {
    let element;
    if (block.type === 'code') {
      element = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      if (block.language) code.dataset.language = block.language;
      element.append(code);
    } else if (block.type === 'separator') {
      element = document.createElement('hr');
    } else if (block.type === 'ordered-list' || block.type === 'unordered-list') {
      element = document.createElement(block.type === 'ordered-list' ? 'ol' : 'ul');
      for (const item of block.items) {
        const row = document.createElement('li');
        appendInline(document, row, item, onLink);
        element.append(row);
      }
    } else {
      element = document.createElement(block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote' : 'p');
      appendInline(document, element, block.text, onLink);
    }
    container.append(element);
  }
}
