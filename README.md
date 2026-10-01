# pi-session-manager

A [Pi](https://pi.dev) extension to search, focus, and resume persisted Pi sessions in **Ghostty on macOS**.

## What it does

- Press **Ctrl+Shift+S** or run `/sessions` from an idle Pi TUI. On macOS that is the physical Control + Shift + S keys — not Command + Shift + S.
- The default picker scope is **live Ghostty Pi terminals**. Registered terminals show their exact Pi session; tabs that were opened before the extension was loaded are listed as `Unregistered Pi · <tab title>` and are still focusable.
- Press **Ctrl+Shift+A** to cycle the picker through open, **closed**, and **all persisted** sessions. `/sessions closed` opens directly in the closed-session scope; `/sessions all` opens directly in the all-session scope.
- Fuzzy-search the current scope by session name, project path, or first prompt. Paths use the configured Fish/Starship compact form (for example `~/s/pi-session-manager`).
- Select a session:
  - a live session focuses its existing Ghostty tab/window;
  - a historical session makes a Ghostty tab and launches `pi --session <session-file>` there.
- Run `/autoname` to name a session from the active branch's verified facts, remaining TODOs, and project area (for example Pi 插件, DNS, or Nginx, inferred from the session directory and task). By default, it generates three one-sentence candidates: use ↑↓ to choose, then tweak and submit the selected `/name ...` command in Pi's editor. Set `autonameMode` to `direct` for a single candidate that is applied after confirmation. In the picker, **Ctrl+Shift+N** names the highlighted registered session; historical sessions use an edit dialog in the default mode because `/name` would rename the current session instead. Unregistered Ghostty terminals remain focus-only until their Pi process loads the extension.
- Tracks live Pi session-to-TTY associations in
  `~/.pi/agent/pi-session-manager.json`.

Pi's JSONL files at `~/.pi/agent/sessions/` remain the source of truth. The registry is only a disposable cache used to associate a live Pi process with a Ghostty terminal. The extension also enumerates Ghostty terminal PIDs to include unregistered Pi tabs as focus-only entries. Stale entries are harmless: Ghostty is queried before a tab is focused, and a new tab is opened when no matching surface exists.

## Install

Install the tagged release from GitHub:

```sh
pi install git:github.com/light4/pi-session-manager@v0.2.15
```

Restart Pi (or run `/reload`) after installing. On macOS, Ghostty must be installed in `/Applications` and allowed to receive Apple Events if macOS asks for permission.

Configure the shortcut and autoname behavior in `~/.pi/agent/pi-session-manager-config.json`:

```json
{ "shortcut": "ctrl+shift+s", "autonameMode": "review" }
```

`review` is the default (three candidates, edit before naming). Use `"autonameMode": "direct"` to generate one candidate and rename immediately after confirmation. The mode is read each time you run `/autoname` or use the picker.

For a one-off override:

```sh
PI_SESSION_MANAGER_SHORTCUT=ctrl+shift+s pi
```

## Limitations

- Only Ghostty on macOS is supported; tmux is not required.
- A Pi session started with `--no-session` cannot be found or resumed.
- The command needs Pi's interactive TUI; it does nothing useful in print/JSON/RPC mode.
- A session opened outside Ghostty is searchable and can be resumed into Ghostty, but cannot be focused in its original terminal.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
```
