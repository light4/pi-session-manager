# pi-session-manager

A terminal-emulator-agnostic session switcher for [Pi](https://pi.dev). Ghostty is the first backend; Kitty, tmux, and Zellij can follow.

## Intended workflow

1. Press a Ghostty shortcut to open `pi-session`.
2. Search Pi sessions by name, project, prompt, or recency.
3. Select a session:
   - focus its existing terminal surface when it is active;
   - otherwise create a terminal tab/window and resume it with `pi --session <path>`.

Pi itself persists conversations under `~/.pi/agent/sessions/`. This project adds the missing runtime association between a Pi session and a Ghostty terminal.

## Design

- **Pi extension** records a session's ID, JSONL path, name, cwd, and terminal TTY in a local registry.
- **Python CLI** indexes persisted Pi sessions and presents a searchable picker.
- **Terminal backends** resolve and focus a terminal surface, or create one when no live surface exists. Ghostty uses its macOS AppleScript dictionary initially.
- **Extensible integrations**: terminal-specific behavior is isolated behind a backend interface; Kitty, tmux, and Zellij can implement the same contract.

The registry is only a convenience cache. Pi JSONL session files remain the source of truth for session metadata.

## Development

```bash
uv sync
uv run ruff check .
uv run ruff format . --check
uv run ty check
uv run pytest
```

## Status

Project scaffold. The next milestone is a read-only `pi-session list` command that discovers and searches Pi's JSONL sessions; Ghostty is the first focus/resume backend.
