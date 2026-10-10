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
- Publishes each live Pi session in its own atomic state file:
  `~/.pi/agent/pi-session-manager/live/<uuidv7>.json`, with a
  `by-pid/<pid>.json` symlink for direct lookup.

Pi's JSONL files remain the source of truth, including custom session storage locations.
State contains `version: 1`, `instanceId` (UUIDv7), `active`, `pid`, `tty`, `cwd`,
`sessionId`, `sessionFile`, and `updatedAt` (Unix milliseconds). Files and directories
are created with permissions 0600 and 0700 respectively. Each plugin instance
atomically replaces only its own UUID file on session start/switch and name changes,
then atomically points `by-pid/<pid>.json` at that file. UUID files are retained on
shutdown with `active: false`; indexes are not deleted, avoiding cleanup races with
new instances. Reload creates a new instance UUID. In-memory and non-TUI sessions
do not publish active state. This avoids shared-registry races and allows direct
lookup without scanning retained UUID files.

Once per interactive plugin load, UUID records not updated for 90 days (approximately
three months) are cleaned up. Active records are retained while their PID still exists;
crash leftovers can be removed once their process is gone. Cleanup never deletes Pi
transcripts or PID indexes. A dangling index is ignored by consumers.

The picker reads PID indexes and verifies active records against live Ghostty PIDs
and TTYs before focusing a session. Ghostty
restoration consumers must additionally reject records older than the foreground
process's start time and validate the referenced JSONL header. Crash leftovers are
not recovery history and must not be selected based on modification time alone.
The old `pi-session-manager.json` registry is no longer read or written; no migration
is required. Unregistered Pi tabs remain focus-only entries.

## Install

Install the tagged release from GitHub:

```sh
pi install git:github.com/light4/pi-session-manager@v0.3.0
```

Restart Pi (or run `/reload`) after installing. On macOS, Ghostty must be installed in `/Applications` and allowed to receive Apple Events if macOS asks for permission.

Configure the shortcut and autoname behavior in `~/.pi/agent/pi-session-manager-config.json`:

```json
{ "shortcut": "ctrl+shift+s", "autonameMode": "review", "stateRetentionDays": 90 }
```

`review` is the default (three candidates, edit before naming). Use `"autonameMode": "direct"` to generate one candidate and rename immediately after confirmation. The mode is read each time you run `/autoname` or use the picker.
`stateRetentionDays` must be a positive number and is read during startup cleanup;
its default is 90 days.

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

GitHub Actions runs typecheck, tests, and a package dry-run on pushes to `main` and pull requests. Unit tests do not exercise live Ghostty or Apple Events; terminal focus still needs manual testing on macOS.

## Release

Bump `package.json` and the install example above, commit, and push a matching `vX.Y.Z` tag. Publish a GitHub Release for that tag; [publish.yml](.github/workflows/publish.yml) verifies the version, runs checks, and publishes to npm with provenance via OIDC. Only the release publishing job has OIDC write permission; no npm token is stored in GitHub.

One-time setup by the npm package owner (requires npm 11.19+ and 2FA):

```sh
npm trust github @light4/pi-session-manager --repo light4/pi-session-manager --file publish.yml --allow-publish --yes
```

If publishing fails, fix the cause and rerun the failed GitHub Actions job. Confirm both the GitHub Release and npm version before updating consumers.
