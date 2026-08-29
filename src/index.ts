import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { CONFIG_DIR_NAME, DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Input, Key, type KeyId, type SelectItem, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);
const REGISTRY_PATH = join(homedir(), CONFIG_DIR_NAME, "agent", "pi-session-manager.json");
// Unlike Option/Alt, Ctrl+Shift is consistently forwarded by Ghostty on macOS.
const DEFAULT_SHORTCUT = Key.ctrlShift("s");

export interface SessionItem {
  id: string;
  file: string;
  cwd: string;
  name?: string;
  prompt?: string;
  updatedAt: number;
}

interface RegistryRecord {
  sessionId: string;
  sessionFile: string;
  tty: string;
  updatedAt: number;
}

interface Registry { records: RegistryRecord[] }
interface Config { shortcut?: string }

export function resolveShortcut(config: Config, environmentShortcut?: string): KeyId {
  const shortcut = environmentShortcut ?? config.shortcut ?? DEFAULT_SHORTCUT;
  return typeof shortcut === "string" && shortcut.trim() ? shortcut.trim() as KeyId : DEFAULT_SHORTCUT;
}

export function fuzzyScore(candidate: string, query: string): number | undefined {
  const haystack = candidate.toLowerCase();
  let cursor = 0;
  let previous = -2;
  let score = 0;
  for (const character of query.trim().toLowerCase()) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return undefined;
    score += 1 + (found === previous + 1 ? 6 : 0) + (found === 0 || /[\s_./:-]/.test(haystack[found - 1] ?? "") ? 3 : 0) - (found - cursor);
    previous = found;
    cursor = found + 1;
  }
  return score;
}

export function rankSessions(sessions: SessionItem[], query: string): SessionItem[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return sessions.map((item) => {
    const searchable = `${item.name ?? ""} ${item.cwd} ${item.prompt ?? ""}`;
    const score = terms.reduce<number | undefined>((total, term) => total === undefined ? undefined : (() => {
      const value = fuzzyScore(searchable, term);
      return value === undefined ? undefined : total + value;
    })(), 0);
    return { item, score };
  }).filter((match): match is { item: SessionItem; score: number } => match.score !== undefined)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .map((match) => match.item);
}

function textContent(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  return content.filter((block): block is { type: "text"; text: string } =>
    block !== null && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string",
  ).map((block) => block.text).join("\n").trim() || undefined;
}

/** Parse a Pi JSONL file without loading it through Pi's session manager. */
export function parseSession(file: string, content: string, updatedAt: number): SessionItem | undefined {
  let id: string | undefined;
  let cwd: string | undefined;
  let name: string | undefined;
  let prompt: string | undefined;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; id?: string; cwd?: string; name?: string; message?: { role?: string; content?: unknown } };
      if (entry.type === "session") { id = entry.id; cwd = entry.cwd; }
      if (entry.type === "session_info" && entry.name !== undefined) name = entry.name || undefined;
      if (entry.type === "message" && entry.message?.role === "user" && !prompt) prompt = textContent(entry.message.content);
    } catch { /* An interrupted final append must not hide an otherwise usable session. */ }
  }
  return id && cwd ? { id, file, cwd, name, prompt, updatedAt } : undefined;
}

async function walkJsonl(directory: string): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkJsonl(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path);
  }
  return result;
}

async function listSessions(): Promise<SessionItem[]> {
  const root = join(homedir(), CONFIG_DIR_NAME, "agent", "sessions");
  const files = await walkJsonl(root);
  const sessions = await Promise.all(files.map(async (file) => {
    try {
      const [content, stats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      return parseSession(file, content, stats.mtimeMs);
    } catch { return undefined; }
  }));
  return sessions.filter((item): item is SessionItem => item !== undefined).sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadConfig(): Config {
  try { return JSON.parse(requireText(join(homedir(), CONFIG_DIR_NAME, "agent", "pi-session-manager-config.json"))) as Config; } catch { return {}; }
}
function requireText(path: string): string { return readFileSync(path, "utf8"); }

async function loadRegistry(): Promise<Registry> {
  try {
    const value: unknown = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
    if (value && typeof value === "object" && Array.isArray((value as Registry).records)) return value as Registry;
  } catch { /* first run or malformed cache */ }
  return { records: [] };
}
async function saveRegistry(registry: Registry): Promise<void> {
  const temporary = `${REGISTRY_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, REGISTRY_PATH);
}
async function currentTty(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "tty=", "-p", String(process.pid)]);
    const tty = stdout.trim();
    return tty && tty !== "??" ? `/dev/${tty}` : undefined;
  } catch { return undefined; }
}

async function ghosttyHasTty(tty: string): Promise<boolean> {
  const script = `on run argv
set targetTTY to item 1 of argv
tell application "Ghostty"
 repeat with theWindow in windows
  repeat with theTab in tabs of theWindow
   repeat with theTerminal in terminals of theTab
    if (tty of theTerminal) is targetTTY then return "found"
   end repeat
  end repeat
 end repeat
end tell
return "not-found"
end run`;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script, tty]);
    return stdout.trim() === "found";
  } catch { return false; }
}

async function focusGhostty(tty: string): Promise<boolean> {
  const script = `on run argv
set targetTTY to item 1 of argv
tell application "Ghostty"
 repeat with theWindow in windows
  repeat with theTab in tabs of theWindow
   repeat with theTerminal in terminals of theTab
    if (tty of theTerminal) is targetTTY then
     focus theTerminal
     return "focused"
    end if
   end repeat
  end repeat
 end repeat
end tell
return "not-found"
end run`;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script, tty]);
    return stdout.trim() === "focused";
  } catch { return false; }
}

async function openGhostty(session: SessionItem): Promise<void> {
  const script = `on run argv
set sessionFile to item 1 of argv
set sessionCwd to item 2 of argv
set shellCommand to "/bin/zsh -lc " & quoted form of ("exec pi --session " & quoted form of sessionFile)
tell application "Ghostty"
 set configuration to new surface configuration
 set command of configuration to shellCommand
 set initial working directory of configuration to sessionCwd
 if (count of windows) is 0 then
  new window with configuration configuration
 else
  new tab in front window with configuration configuration
 end if
 activate
end tell
end run`;
  await execFileAsync("osascript", ["-e", script, session.file, session.cwd]);
}

async function registerCurrentSession(ctx: ExtensionContext): Promise<void> {
  const file = ctx.sessionManager.getSessionFile();
  const tty = await currentTty();
  if (!file || !tty) return;
  const registry = await loadRegistry();
  const sessionId = ctx.sessionManager.getSessionId();
  registry.records = registry.records.filter((record) => !(record.sessionId === sessionId && record.tty === tty));
  registry.records.push({ sessionId, sessionFile: file, tty, updatedAt: Date.now() });
  await saveRegistry(registry);
}
async function unregisterCurrentSession(ctx: ExtensionContext): Promise<void> {
  const tty = await currentTty();
  if (!tty) return;
  const registry = await loadRegistry();
  registry.records = registry.records.filter((record) => !(record.sessionId === ctx.sessionManager.getSessionId() && record.tty === tty));
  await saveRegistry(registry);
}

function label(session: SessionItem): string { return session.name ?? session.prompt?.replace(/\s+/g, " ") ?? basename(session.file); }

/** Return sessions whose registered TTY still belongs to a live Ghostty surface. */
async function liveSessions(sessions: SessionItem[]): Promise<SessionItem[]> {
  const registry = await loadRegistry();
  const liveRecords = (await Promise.all(registry.records.map(async (record) =>
    (await ghosttyHasTty(record.tty)) ? record : undefined,
  ))).filter((record): record is RegistryRecord => record !== undefined);
  if (liveRecords.length !== registry.records.length) await saveRegistry({ records: liveRecords });
  const ids = new Set(liveRecords.map((record) => record.sessionId));
  return sessions.filter((session) => ids.has(session.id));
}

async function activateSession(session: SessionItem, ctx: ExtensionContext): Promise<void> {
  const registry = await loadRegistry();
  for (const record of registry.records.filter((item) => item.sessionId === session.id).sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (await focusGhostty(record.tty)) { ctx.ui.notify(`Focused: ${label(session)}`, "info"); return; }
  }
  try { await openGhostty(session); ctx.ui.notify(`Opened: ${label(session)}`, "info"); }
  catch (error) { ctx.ui.notify(`Unable to open Ghostty: ${error instanceof Error ? error.message : String(error)}`, "error"); }
}

async function showSessions(ctx: ExtensionContext, initialScope: "live" | "all" = "live"): Promise<void> {
  if (ctx.mode !== "tui") { ctx.ui.notify("/sessions requires Pi's interactive TUI.", "warning"); return; }
  const sessions = await listSessions();
  if (!sessions.length) { ctx.ui.notify("No persisted Pi sessions found.", "info"); return; }
  const live = await liveSessions(sessions);
  const selected = await ctx.ui.custom<string | null>((tui, theme, _keys, done) => {
    const input = new Input(); const container = new Container(); let scope = initialScope;
    let candidates = scope === "live" ? live : sessions; let matches = candidates; let selectedIndex = 0; let selectList: SelectList;
    const createList = () => {
      const items: SelectItem[] = matches.slice(0, 200).map((item) => ({ value: item.id, label: label(item), description: item.cwd }));
      selectList = new SelectList(items, 10, { selectedPrefix: (text) => theme.fg("accent", text), selectedText: (text) => theme.fg("accent", text), description: (text) => theme.fg("muted", text), scrollInfo: (text) => theme.fg("dim", text), noMatch: (text) => theme.fg("warning", text) });
      selectList.setSelectedIndex(selectedIndex);
    };
    const refresh = () => { matches = rankSessions(candidates, input.getValue()); selectedIndex = 0; createList(); };
    const toggleScope = () => { scope = scope === "live" ? "all" : "live"; candidates = scope === "live" ? live : sessions; refresh(); };
    const move = (delta: number) => { if (matches.length) { selectedIndex = (selectedIndex + delta + matches.length) % matches.length; selectList.setSelectedIndex(selectedIndex); } };
    createList();
    return {
      get focused() { return input.focused; }, set focused(value: boolean) { input.focused = value; },
      render(width: number) { container.clear(); container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text))); container.addChild(new Text(theme.fg("accent", theme.bold(scope === "live" ? `Open Pi sessions (${live.length})` : `All Pi sessions (${sessions.length})`)), 1, 0)); container.addChild(new Text(theme.fg("dim", "search name, project, or prompt:"), 1, 0)); container.addChild(input); container.addChild(selectList); container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter focus/open • ctrl+shift+a all/open • esc cancel"), 1, 0)); container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text))); return container.render(width); },
      invalidate() { container.invalidate(); input.invalidate(); selectList.invalidate(); },
      handleInput(data: string) { if (matchesKey(data, Key.ctrlShift("a"))) toggleScope(); else if (matchesKey(data, Key.up)) move(-1); else if (matchesKey(data, Key.down)) move(1); else if (matchesKey(data, Key.pageUp)) move(-10); else if (matchesKey(data, Key.pageDown)) move(10); else if (matchesKey(data, Key.enter)) { const item = selectList.getSelectedItem(); if (item) done(item.value); } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(null); else { input.handleInput(data); refresh(); } tui.requestRender(); },
    };
  }, { overlay: true, overlayOptions: { width: "80%", minWidth: 45, maxHeight: "70%" } });
  const session = selected === null ? undefined : sessions.find((item) => item.id === selected);
  if (session) await activateSession(session, ctx);
}

export default function sessionManagerExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => { await registerCurrentSession(ctx); });
  pi.on("session_info_changed", async (_event, ctx) => { await registerCurrentSession(ctx); });
  pi.on("session_shutdown", async (_event, ctx) => { await unregisterCurrentSession(ctx); });
  pi.registerShortcut(resolveShortcut(loadConfig(), process.env.PI_SESSION_MANAGER_SHORTCUT), { description: "Find and focus or resume a Pi session", handler: showSessions });
  pi.registerCommand("sessions", { description: "Find live Pi sessions; pass 'all' to include history", handler: async (args, ctx) => showSessions(ctx, args.trim() === "all" ? "all" : "live") });
}
