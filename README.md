# SideTerm

SideTerm is a native-feeling terminal for Ubuntu, Windows, and macOS with live shell sessions arranged in a resizable, collapsible left sidebar instead of tabs across the top. Its layout and shortcuts borrow the practical parts of Windows Terminal while keeping normal shell behavior intact.

> [!IMPORTANT]
> SideTerm is still a work in progress. Features, settings, and platform support may change as development continues.

## What it does

- Runs real interactive shell sessions through a PTY (your configured `$SHELL` on Linux/macOS with Bash as fallback; PowerShell on Windows, overridable via `SIDETERM_SHELL`).
- Organizes sessions into persistent, collapsible, color-coded groups. Each group color is configurable from its header. New groups start with a session, and each group has its own add-session button; groups may become empty when sessions are moved out. Groups and sessions can be dragged, reordered, and moved with focused drop zones and snap indicators.
- Renames a group by clicking its title, and confirms before deleting a group and terminating every session inside it.
- Keeps running shells and coding agents alive when the SideTerm window closes, then reconnects to them when it reopens. On Ubuntu, SideTerm bundles an isolated tmux backend, so this does not require a system tmux installation. On Windows, a detached local PTY host keeps native PowerShell sessions alive across SideTerm restarts. macOS sessions currently run directly and end with the app.
- Restores group layout, session order, active state, working directories, unread state, link history, and bounded scrollback after restarting SideTerm or the computer.
- Marks completed/stopped background work with a red session dot and aggregates unread counts on each group. Each submitted prompt creates one notification cycle, preventing idle terminal repaints from repeatedly re-arming a dot.
- Shows an animated activity ring while a submitted task is continuously producing output, while ignoring terminal redraws and terminal-generated focus/query responses.
- Keeps every open session visible in a resizable left rail and lets you collapse the rail to icons.
- Uses `Ctrl+C` to copy selected terminal text; with no selection it still sends `SIGINT` to the running command.
- Uses `Ctrl+V` to paste. `Ctrl+Shift+C` and `Ctrl+Shift+V` work too.
- Uses the mouse wheel for visible terminal scrollback instead of shell/query history. Hold `Ctrl` while scrolling to pass the wheel through to the foreground terminal application.
- Adds session shortcuts: `Ctrl+Shift+T` creates one, `Ctrl+Shift+W` closes one, `Ctrl+Tab` cycles, and `Ctrl+Shift+B` collapses the sidebar.
- Lets every productivity shortcut be overridden from Settings (`Ctrl+,`).
- Captures HTTP(S) links printed in each session and shows them chronologically from the link badge. GitHub links are filtered to canonical pull-request URLs and remain detectable when terminal output splits the URL across chunks.
- Renames the active session by clicking its title in the top command bar; manual titles persist and override later shell title changes.
- Provides an authenticated mobile web app from the phone icon beside Settings. Every Tailscale, local-network, and localhost address has its own collapsible QR code. It mirrors live groups and terminal sessions, supports touch-drag scrollback, includes a visible command/prompt composer and quick keys, and can be saved to a phone home screen.
- Adds an opt-in persistent supervisor and voice agent that helps manage sessions: ask what is running or finished, inspect bounded session context, create and name sessions, receive completion catch-ups, and review proposed terminal actions or archival from desktop or mobile.
- Queues the current branch pull request after a successful commit or push, checks open PRs every minute, routes new Codex review comments back to the linked coding chat, and asks before merging after Codex reacts 👍 to the main post.
- Gives the supervisor narrow modular tools to inspect session context, create and relevantly name sessions, request archival, use semantic TUIs, and propose exact terminal input. Destructive or raw terminal actions remain policy- and confirmation-gated.
- Adds optional DeepSeek Harness integration through an authenticated loopback bridge. Harness instructions use `followup`, `steer`, or `inject`; SideTerm does not type them into the agent PTY.
- Adds local opt-in voice mode with configurable personality, agent instructions, wake word, NVIDIA Parakeet STT, Pocket TTS voice, per-voice preview, and explicit model installers. A rebindable keyboard chord (`Ctrl+Shift+A` by default) activates listening without the wake word. Explicitly selected cloud STT providers never receive audio through silent fallback.
- Optionally uses a custom OpenAI-compatible provider to turn recent coding-terminal activity into useful two-line labels such as `Codex: Fix token refresh` or `Hermes: Review checkout PR`.
- Right-click copies a selection or pastes when nothing is selected.
- Produces Ubuntu `.deb` and AppImage packages, including app-menu/taskbar launcher metadata.

## Optional AI session naming

Open **Settings → AI session context**, enter your provider's API base URL (or full `/chat/completions` URL), model name, and optional API key. Enable automatic naming and test the connection. SideTerm sends standard OpenAI-compatible Chat Completions requests, so it can work with local servers and hosted compatible providers instead of being tied to OpenAI. Naming runs once, after the first context-bearing command or agent prompt is submitted; launching a bare `codex`, `claude`, `hermes`, or `gemini` command does not trigger it.

Recent terminal context is sent only when this feature is enabled. The API key is encrypted through Electron's OS-backed secure storage and is never exposed through the renderer bridge or written to workspace/localStorage data.

SideTerm recognizes common coding-agent commands including Codex, Hermes, Claude, and Gemini. Before AI is configured, session labels retain the normal terminal title and shell/directory details.

## Strands supervisor and voice mode

Open **Settings → Strands supervisor**, enable the agent, and customize its Personality and Agent instructions. It uses the same custom OpenAI-compatible API URL, model, and encrypted optional provider key as session naming. Its conversation snapshots, completion inbox, confirmations, and archived-session summaries persist locally across app restarts.

The supervisor can list and inspect bounded session context, create a terminal with a relevant manual name, and request that completed sessions be archived. Any terminal input or archival request is shown as an Approve/Deny card on both desktop and mobile. Terminal output is treated as untrusted evidence rather than agent instructions.

With voice mode enabled, the supervisor also works as a hands-free session manager. You can ask which sessions are active or finished, request a concise update, inspect a named session, create and name a new session, or respond to a proposed action. SideTerm keeps terminal input and archival behind explicit confirmation so voice interaction does not bypass its safety controls.

Voice mode is off until explicitly enabled from an agent dashboard. NVIDIA Parakeet is the local/default speech-to-text provider. Deepgram, Google, Azure, AWS, and OpenAI are available only after selecting that cloud provider and saving its encrypted credential; SideTerm never silently changes providers. Install Pocket TTS separately, select one of its included voices, and use **Play preview** before saving. The configurable wake word and browser-side VAD reject short noise, breaths, and empty audio before invoking the agent. If recognition is uncertain, SideTerm pauses and asks colloquially, “Did you mean …?” instead of acting on a dubious transcript. After the supervisor speaks, its next reply window remains open for 30 seconds without requiring the wake word; unsolicited requests still require it.

## Optional DeepSeek Harness bridge

The installable bundle lives at `plugins/dsh-sideterm-bridge` in a source checkout. The `.deb` installs it at `/opt/SideTerm/resources/plugins/dsh-sideterm-bridge`. For an AppImage, run `./SideTerm-*.AppImage --appimage-extract` once and use `./squashfs-root/resources/plugins/dsh-sideterm-bridge`. Install the matching path into the Harness profile you use, then configure the same random bridge token in that profile and in **SideTerm Settings → Supervisor**:

```bash
dsh plugin --profile demo add ./plugins/dsh-sideterm-bridge
```

The bridge binds only to loopback, requires a token of at least 24 characters, publishes the `session/event` feed, and exposes bounded agent metadata plus semantic `followup` / `steer` / `inject` delivery. The bundle intentionally ships with a blank token and refuses to start until you provide one; its own README contains the complete profile override.

## Run for development

Requirements: Ubuntu, Windows 10 or newer, or macOS; Node.js 20 or newer; npm; and the native build toolchain used by `node-pty` (Ubuntu: `build-essential`, Python, and `libsecret-1-dev`; Windows: Visual Studio Build Tools, though node-pty's prebuilt binaries usually make a rebuild unnecessary; macOS: Xcode Command Line Tools).

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
sudo apt install ./release/SideTerm-0.3.0-amd64.deb
```

After installation, open the Ubuntu app grid, search for **SideTerm**, launch it, then right-click its dock icon and choose **Pin to Dash** / **Add to Favorites**. The AppImage in `release/` can also run without installation after `chmod +x`.

## Run on Windows or macOS

Packaged installers currently target Ubuntu only. On Windows and macOS, run from source using the development flow above. Windows sessions default to PowerShell (override with `SIDETERM_SHELL`), and macOS sessions use your configured `$SHELL`.

## Security model

The renderer has no Node.js access. A narrow preload bridge is the only path to PTY, settings, AI, local speech, approved HTTP(S) links, and clipboard operations. External navigation is blocked, API credentials remain in the main process, supervisor terminal writes are confirmation-gated, and each session is explicitly cleaned up when closed.

With **Keep running in background** enabled, closing the window hides SideTerm in the tray so monitoring, PR watches, voice/mobile access, and attached terminals remain active. Use the tray's explicit Quit action to stop the application. SideTerm does not register login autostart. Explicitly closing a session or confirming group deletion terminates the corresponding shell and child processes. Workspace restoration recreates shells in their saved working directories and replays bounded scrollback after an operating-system restart. Running processes cannot survive an operating-system restart.

Mobile access is disabled until enabled from the phone icon, then retains that choice and starts automatically with SideTerm after a restart. SideTerm binds its companion server to port `43110` and protects it with a persistent random URL key. Use the Tailscale URL when available, or the local-network URL while both devices are on a trusted network. When the supervisor is enabled, mobile opens on its dashboard by default and provides a one-tap Terminal switch. Disable mobile access from the same panel to close connected phones immediately.

Mobile microphone APIs require a secure browser context. `localhost` works for local testing; for a phone, use **Enable Tailscale HTTPS** in SideTerm's mobile setup panel and then scan the generated **Tailscale HTTPS · voice enabled** QR code. Text chat, notifications, approvals, terminal input, and touch scrollback continue to work over the authenticated HTTP local-network URL.

## License

MIT
