(function exposeTerminalReflow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SideTermTerminalReflow = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const SGR_RESET = '\x1b[0m';
  // xterm packs the color mode into a 2-bit field at bits 24-25 of the cell
  // attribute (verified against @xterm/xterm 6):
  // 1 = 16-color palette, 2 = 256-color palette, 3 = 24-bit RGB.
  const COLOR_PALETTE_16 = 1;
  const COLOR_PALETTE_256 = 2;
  const COLOR_RGB = 3;

  function colorModeField(mode) {
    return (Number(mode) >>> 24) & 3;
  }

  function colorParams(mode, value, background) {
    const field = colorModeField(mode);
    const extended = background ? 48 : 38;
    if (field === COLOR_RGB) {
      return `${extended};2;${(value >> 16) & 0xff};${(value >> 8) & 0xff};${value & 0xff}`;
    }
    if (field === COLOR_PALETTE_256) {
      return `${extended};5;${value}`;
    }
    if (field === COLOR_PALETTE_16) {
      if (value < 8) return String((background ? 40 : 30) + value);
      if (value < 16) return String((background ? 100 : 90) + value - 8);
      return `${extended};5;${value}`;
    }
    return '';
  }

  function attributeParams(cell) {
    const params = [];
    if (cell.isBold?.()) params.push('1');
    if (cell.isDim?.()) params.push('2');
    if (cell.isItalic?.()) params.push('3');
    if (cell.isUnderline?.()) params.push('4');
    if (cell.isInvisible?.()) params.push('8');
    if (cell.isInverse?.()) params.push('7');
    if (cell.isStrikethrough?.()) params.push('9');
    const fg = colorParams(cell.getFgColorMode?.() || 0, cell.getFgColor?.() || 0, false);
    if (fg) params.push(fg);
    const bg = colorParams(cell.getBgColorMode?.() || 0, cell.getBgColor?.() || 0, true);
    if (bg) params.push(bg);
    return params.join(';');
  }

  // serializeLine renders one physical row. Trailing-space padding is only
  // trimmed on rows that are not continued by a soft-wrapped successor, so a
  // real space on the final column of a wrapped row survives the join.
  function serializeLine(line, columns, scratchCell, trimTail) {
    const parts = [];
    let charCount = 0;
    let active = '';
    for (let x = 0; x < columns; x += 1) {
      const cell = line.getCell(x, scratchCell);
      if (!cell) break;
      if ((cell.getWidth?.() ?? 1) === 0) continue;
      const params = attributeParams(cell);
      if (params !== active) {
        if (active) parts.push(SGR_RESET);
        if (params) parts.push(`\x1b[${params}m`);
        active = params;
      }
      parts.push(cell.getChars() || ' ');
      charCount += 1;
    }
    if (!charCount) return '';
    let poppedStyle = false;
    if (trimTail) {
      // Pop trailing padding and any style tokens that only styled it — a
      // trailing SGR run decorates nothing once its spaces are gone.
      while (parts.length) {
        const last = parts[parts.length - 1];
        if (last === ' ') {
          parts.pop();
          continue;
        }
        if (last.charCodeAt(0) === 27) {
          poppedStyle = true;
          parts.pop();
          continue;
        }
        break;
      }
    }
    // A row that held only styled padding serializes to nothing, so the
    // caller's trailing-blank trim can drop it.
    if (!parts.length) return '';
    // Close any style the line still holds so it cannot leak into the next
    // serialized line on the phone.
    if (active || poppedStyle) parts.push(SGR_RESET);
    return parts.join('');
  }

  class TerminalReflow {
    constructor({ Terminal, maxLines = 400, cols = 80, rows = 24 } = {}) {
      if (typeof Terminal !== 'function') throw new Error('TerminalReflow requires an xterm Terminal constructor.');
      this.maxLines = Math.max(1, Math.floor(maxLines) || 400);
      // No convertEol: raw PTY streams use VT line-feed semantics. Capture
      // frames are CRLF-normalized by the caller before replay.
      this.model = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
      this.scratchCell = this.model.buffer.active.getNullCell();
      this.modelSessionCols = cols;
    }

    resize(cols, rows) {
      const nextCols = Math.max(2, Math.floor(Number(cols) || this.modelSessionCols));
      const nextRows = Math.max(1, Math.floor(Number(rows) || this.model.rows));
      if (nextCols === this.model.cols && nextRows === this.model.rows) return;
      this.modelSessionCols = nextCols;
      this.model.resize(nextCols, nextRows);
    }

    reset() {
      this.model.reset();
    }

    write(data, callback) {
      this.model.write(data, callback);
    }

    serialize() {
      const buffer = this.model.buffer.active;
      const columns = this.model.cols;
      const end = buffer.length;
      let trailingBlanks = 0;
      for (let y = end - 1; y >= 0 && trailingBlanks < this.maxLines; y -= 1) {
        const line = buffer.getLine(y);
        if (line?.translateToString(true)) break;
        trailingBlanks += 1;
      }
      const startLine = Math.max(0, end - this.maxLines - trailingBlanks);
      const lines = [];
      let cursorTextRow = -1;
      const cursorBufferRow = buffer.baseY + buffer.cursorY;
      for (let y = startLine; y < end; y += 1) {
        const line = buffer.getLine(y);
        if (!line) continue;
        const next = y + 1 < end ? buffer.getLine(y + 1) : null;
        const text = serializeLine(line, columns, this.scratchCell, !next?.isWrapped);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
        else lines.push(text);
        if (y === cursorBufferRow) cursorTextRow = lines.length - 1;
      }
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      let serialized = lines.join('\r\n');
      // Reproduce the application's cursor position; the visible terminal is
      // rewritten wholesale each frame, so the cursor must be placed afresh.
      // Rows the trim dropped clamp the cursor to the last serialized row.
      if (cursorTextRow >= 0) {
        if (cursorTextRow >= lines.length) cursorTextRow = lines.length - 1;
        serialized += `\x1b[${cursorTextRow + 1};${Math.min(columns, buffer.cursorX + 1)}H`;
      }
      return serialized;
    }
  }

  return { TerminalReflow, colorParams, attributeParams };
}));
