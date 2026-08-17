# SideTerm

SideTerm is a native-feeling Ubuntu terminal with live shell sessions arranged in a resizable, collapsible left sidebar instead of tabs across the top. Its layout and shortcuts borrow the practical parts of Windows Terminal while keeping normal Unix shell behavior intact.

## What it does

- Runs real interactive shell sessions through a PTY (your configured `$SHELL`, with Bash as fallback).
- Organizes sessions into persistent, collapsible groups. Groups and sessions can be dragged, reordered, and moved with focused drop zones and snap indicators.
- Restores group layout, session order, active state, working directories, unread state, link history, and bounded scrollback after restarting SideTerm or Ubuntu.
- Marks completed/stopped background work with a red session dot and aggregates unread counts on each group.
- Keeps every open session visible in a resizable left rail and lets you collapse the rail to icons.
- Uses `Ctrl+C` to copy selected terminal text; with no selection it still sends `SIGINT` to the running command.
- Uses `Ctrl+V` to paste. `Ctrl+Shift+C` and `Ctrl+Shift+V` work too.
- Adds session shortcuts: `Ctrl+Shift+T` creates one, `Ctrl+Shift+W` closes one, `Ctrl+Tab` cycles, and `Ctrl+Shift+B` collapses the sidebar.
- Lets every productivity shortcut be overridden from Settings (`Ctrl+,`).
- Captures HTTP(S) links printed in each session and shows them chronologically from the link badge on that session.
- Optionally uses an OpenAI model to turn recent coding-terminal activity into useful two-line labels such as `Codex: Fix token refresh` or `Hermes: Review checkout PR`.
- Right-click copies a selection or pastes when nothing is selected.
- Produces Ubuntu `.deb` and AppImage packages, including app-menu/taskbar launcher metadata.

## Optional AI session naming

Open **Settings → AI session context**, enter an OpenAI API key, choose a model, enable automatic naming, and test the connection. SideTerm uses the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) and defaults to `gpt-5.6-luna`; the model field is editable.

Recent terminal context is sent only when this feature is enabled. The API key is encrypted through Electron's OS-backed secure storage and is never exposed through the renderer bridge or written to workspace/localStorage data.

SideTerm recognizes common coding-agent commands including Codex, Hermes, Claude, and Gemini. Before AI is configured, session labels retain the normal terminal title and shell/directory details.

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
sudo apt install ./release/SideTerm-0.2.0-amd64.deb
```

After installation, open the Ubuntu app grid, search for **SideTerm**, launch it, then right-click its dock icon and choose **Pin to Dash** / **Add to Favorites**. The AppImage in `release/` can also run without installation after `chmod +x`.

## Security model

The renderer has no Node.js access. A narrow preload bridge is the only path to PTY, settings, AI, approved HTTP(S) links, and clipboard operations. External navigation is blocked, API credentials remain in the main process, and each session is explicitly cleaned up when closed.

Workspace restoration recreates shells in their saved working directories and replays bounded scrollback. Running processes cannot survive an operating-system restart.

## License

MIT
