import assert from "node:assert/strict";
import test from "node:test";

import { displayPath, fuzzyScore, parseSession, parseSessionScope, rankSessions, resolveShortcut, SessionScope } from "../src/index.ts";

test("parseSession extracts latest name and first user prompt", () => {
  const session = parseSession("/tmp/session.jsonl", [
    '{"type":"session","id":"abc123","cwd":"/repo"}',
    '{"type":"message","message":{"role":"user","content":"Fix the login flow"}}',
    '{"type":"session_info","name":"Auth repair"}',
  ].join("\n"), 42);
  assert.deepEqual(session, { id: "abc123", file: "/tmp/session.jsonl", cwd: "/repo", name: "Auth repair", prompt: "Fix the login flow", updatedAt: 42 });
});

test("rankSessions matches across name, cwd, and prompt", () => {
  const sessions = [
    { id: "a", file: "a", cwd: "/work/api", name: "API incident", updatedAt: 1 },
    { id: "b", file: "b", cwd: "/work/web", prompt: "Fix checkout button", updatedAt: 2 },
  ];
  assert.deepEqual(rankSessions(sessions, "checkout").map((item) => item.id), ["b"]);
  assert.deepEqual(rankSessions(sessions, "api").map((item) => item.id), ["a"]);
});

test("displayPath follows the configured Fish-style compact home path", () => {
  assert.equal(displayPath("/Users/chenyuanning/sources/pi-session-manager"), "~/s/pi-session-manager");
  assert.equal(displayPath("/Users/chenyuanning/astratech/payby/terraform/payby-terraform-azure"), "~/a/p/t/payby-terraform-azure");
});

test("fuzzy matching and shortcut configuration behave predictably", () => {
  assert.notEqual(fuzzyScore("Pi session manager", "psm"), undefined);
  assert.equal(fuzzyScore("Pi session manager", "smp"), undefined);
  assert.equal(resolveShortcut({ shortcut: "ctrl+shift+s" }), "ctrl+shift+s");
  assert.equal(resolveShortcut({ shortcut: "" }), "ctrl+shift+s");
  assert.equal(parseSessionScope("closed"), SessionScope.Closed);
  assert.equal(parseSessionScope("unexpected"), SessionScope.Live);
});
