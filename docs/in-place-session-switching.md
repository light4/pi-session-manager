# In-place Pi session switching

## Goal

Allow a user to select a persisted Pi session in the session picker and resume it in the **current Pi TUI / Ghostty terminal**, instead of focusing an existing tab or opening a new one.

Pi exposes the required command-context API:

```ts
await ctx.switchSession(sessionFile);
```

Its runtime reloads the target session using the JSONL header's `cwd`, so Pi's effective working directory (footer, file completion, built-in tools, project context) changes with the session. A child Pi process cannot change its parent Fish shell's working directory, so the shell returns to its original directory when Pi exits.

## Safety problem: is the selected session live?

Opening the same JSONL session in two active Pi processes can cause concurrent appends and confused session state. Therefore an in-place switch must only target a **confirmed closed** session.

The picker has three relevant categories:

| Category | Evidence | Allowed action |
| --- | --- | --- |
| Registered live session | A registry record maps Pi session ID to TTY, and Ghostty confirms the TTY still has a Pi foreground process. | Focus the existing Ghostty terminal. Do not switch the current TUI into it. |
| Unregistered live terminal | Ghostty reports a Pi terminal PID/TTY, but the process has not loaded this extension, so no session ID is known. | Focus only. |
| Confirmed closed session | No registered live mapping exists, and no unregistered Pi terminal creates ambiguity for its working directory. | Open a new terminal or switch the current TUI. |

An existing Pi process that predates installation/reload is deliberately treated as an **unregistered terminal**. Its exact session file cannot be recovered reliably from `ps`, PID, TTY, or cwd: multiple Pi sessions can share a cwd. It becomes a registered live session after `/reload` or restart.

## Proposed interaction

Keep the default `Enter` behavior:

- registered or unregistered live target → focus its Ghostty terminal;
- confirmed closed target → open a new Ghostty tab and resume it.

Add `Ctrl+Shift+Enter` to switch the **current Pi TUI** only when the highlighted session is confirmed closed. For registered live and unregistered targets, show a warning and leave the current session unchanged.

## Open questions

- How should the picker visually distinguish `closed` from `unknown due to unregistered Pi in same cwd`?
- Should a user be able to explicitly override the safe guard after confirmation?
- Can future Pi releases expose the active session file through a process-visible environment variable, removing the unregistered-terminal ambiguity?
