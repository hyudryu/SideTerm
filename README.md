# SideTerm

SideTerm is a native-feeling Ubuntu terminal with live shell sessions arranged in a collapsible left sidebar instead of tabs across the top. Its layout and shortcuts borrow the practical parts of Windows Terminal while keeping normal Unix shell behavior intact.

## What it does

- Runs real interactive shell sessions through a PTY (your configured `$SHELL`, with Bash as fallback).
- Keeps every open session visible in a left rail and lets you collapse the rail to icons.
- Uses `Ctrl+C` to copy selected terminal text; with no selection it still sends `SIGINT` to the running command.
- Uses `Ctrl+V` to paste. `Ctrl+Shift+C` and `Ctrl+Shift+V` work too.
- Adds session shortcuts: `Ctrl+Shift+T` creates one, `Ctrl+Shift+W` closes one, `Ctrl+Tab` cycles, and `Ctrl+Shift+B` collapses the sidebar.
- Right-click copies a selection or pastes when nothing is selected.
- Produces Ubuntu `.deb` and AppImage packages, including app-menu/taskbar launcher metadata.

## Run for development

Requirements: Ubuntu, Node.js 20 or newer, npm, and the native build toolchain used by `node-pty` (`build-essential`, Python, and `libsecret-1-dev` may be needed depending on your Electron installation).

```bash
npm install
```

In terminal one:

```bash
npm run dev
```

In terminal two:

```bash
SIDETERM_DEV_URL=http://127.0.0.1:5173 npm start
```

## Build and install on Ubuntu

```bash
npm run dist
sudo apt install ./release/SideTerm-0.1.0-amd64.deb
```

After installation, open the Ubuntu app grid, search for **SideTerm**, launch it, then right-click its dock icon and choose **Pin to Dash** / **Add to Favorites**. The AppImage in `release/` can also run without installation after `chmod +x`.

## Security model

The renderer has no Node.js access. A narrow preload bridge is the only path to PTY and clipboard operations, external navigation is blocked, and each session is explicitly cleaned up when closed.

## License

MIT
