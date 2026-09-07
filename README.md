# pi-session-manager

A terminal-emulator-agnostic [Pi](https://pi.dev) extension to search, focus, and resume persisted Pi sessions. The first backend is **Ghostty on macOS**; its terminal-specific operations are isolated so Kitty, tmux, and Zellij backends can be added later.

## What it does

- Press **Ctrl+Shift+S** or run `/sessions` from an idle Pi TUI. On macOS that is the physical Control + Shift + S keys — not Command + Shift + S.
- The default picker scope is **live Ghostty Pi terminals**. Registered terminals show their exact Pi session; tabs that were opened before the extension was loaded are listed as `Unregistered Pi · <tab title>` and are still focusable.
- Press **Ctrl+Shift+A** to cycle the picker through open, **closed**, and **all persisted** sessions. `/sessions closed` opens directly in the closed-session scope; `/sessions all` opens directly in the all-session scope.
- Fuzzy-search the current scope by session name, project path, or first prompt. Paths use the configured Fish/Starship compact form (for example `~/s/pi-session-manager`).
- Select a session:
  - a live session focuses its existing Ghostty tab/window;
  - a historical session makes a Ghostty tab and launches `pi --session <session-file>` there.
- Run `/autoname` to generate a real Pi session name from the active branch's chat history. It preserves central ticket prefixes and system/product/acronym identifiers, and targets a descriptive 12–30 Chinese-character or 5–15 English-word title. The picker also exposes this action as **Ctrl+Shift+N**; it generates a name for the highlighted registered session, including a closed historical session. Unregistered Ghostty terminals remain focus-only until their Pi process loads the extension.
- Tracks live Pi session-to-TTY associations in
  `~/.pi/agent/pi-session-manager.json`.

Pi's JSONL files at `~/.pi/agent/sessions/` remain the source of truth. The registry is only a disposable cache used to associate a live Pi process with a Ghostty terminal. The extension also enumerates Ghostty terminal PIDs to include unregistered Pi tabs as focus-only entries. Stale entries are harmless: Ghostty is queried before a tab is focused, and a new tab is opened when no matching surface exists.

## Install

Install the tagged release from GitHub:

```sh
pi install git:github.com/light4/pi-session-manager@v0.2.12
```

Or, after the corresponding npm release is available, install it from npm:

```sh
pi install npm:@light4/pi-session-manager@0.2.12
```

Restart Pi (or run `/reload`) after installing. On macOS, Ghostty must be installed in `/Applications` and allowed to receive Apple Events if macOS asks for permission.

The global shortcut is configurable in `~/.pi/agent/pi-session-manager-config.json`:

```json
{ "shortcut": "ctrl+shift+s" }
```

For a one-off override:

```sh
PI_SESSION_MANAGER_SHORTCUT=ctrl+shift+s pi
```

## Limitations

- This release implements Ghostty/macOS only. It intentionally does not require tmux.
- A Pi session started with `--no-session` cannot be found or resumed.
- The command needs Pi's interactive TUI; it does nothing useful in print/JSON/RPC mode.
- A session opened outside Ghostty is searchable and can be resumed into Ghostty, but cannot be focused in its original terminal.

## Development

```sh
npm install
npm run typecheck
npm test
```
