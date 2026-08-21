const { cleanTerminalText } = require('../sessions/tui.cjs');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function terminalViewportText(text, rows = 30) {
  return cleanTerminalText(text).split('\n').slice(-rows).join('\n').slice(-30_000);
}

function terminalScreenshotHtml(text, title = 'Terminal') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c0c0c;color:#f2f2f2;font:16px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}header{height:44px;box-sizing:border-box;padding:11px 16px;background:#202020;color:#d8d8d8;border-bottom:1px solid #383838;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}pre{box-sizing:border-box;margin:0;height:calc(100% - 44px);padding:14px 16px;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><header>${escapeHtml(title)}</header><pre>${escapeHtml(terminalViewportText(text))}</pre></body></html>`;
}

async function captureTerminalScreenshot(BrowserWindowClass, text, title) {
  const captureWindow = new BrowserWindowClass({
    show: false, width: 1200, height: 720, backgroundColor: '#0c0c0c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true }
  });
  try {
    await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(terminalScreenshotHtml(text, title))}`);
    const image = (await captureWindow.webContents.capturePage()).toPNG();
    if (!image.length) throw new Error('The requested terminal returned an empty screenshot.');
    return image;
  } finally {
    if (!captureWindow.isDestroyed()) captureWindow.destroy();
  }
}

module.exports = { captureTerminalScreenshot, escapeHtml, terminalScreenshotHtml, terminalViewportText };
