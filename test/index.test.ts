import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { autonameSession, conversationForTitle, displayPath, fuzzyScore, parseSession, parseSessionScope, rankSessions, resolveShortcut, SessionScope } from "../src/index.ts";

test("parseSession extracts latest name and first user prompt", () => {
  const session = parseSession("/tmp/session.jsonl", [
    '{"type":"session","id":"abc123","cwd":"/repo"}',
    '{"type":"message","message":{"role":"user","content":"Fix the login flow"}}',
    '{"type":"session_info","name":"Auth repair"}',
  ].join("\n"), 42);
  assert.deepEqual(session, { id: "abc123", file: "/tmp/session.jsonl", cwd: "/repo", name: "Auth repair", prompt: "Fix the login flow", updatedAt: 42 });
});

test("autoname summarizes the active branch's facts and TODO without truncating the name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-manager-"));
  try {
    const file = join(dir, "session.jsonl");
    writeFileSync(file, [
      { type: "session", version: 3, id: "session", timestamp: "2026-01-01T00:00:00Z", cwd: "/work/pi-session-manager" },
      { type: "message", id: "1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "Check Pi autoname" } },
      { type: "message", id: "2", parentId: "1", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: "Abandoned TODO: rename Pi sessions manually" } },
      { type: "message", id: "3", parentId: "1", timestamp: "2026-01-01T00:00:03Z", message: { role: "assistant", content: [{ type: "text", text: "Verified: Pi autoname reads the active branch; TODO: test historical sessions" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const branch = SessionManager.open(file).getBranch();
    assert.match(conversationForTitle(branch), /Verified: Pi autoname reads the active branch; TODO: test historical sessions/);
    assert.doesNotMatch(conversationForTitle(branch), /Abandoned TODO/);

    let prompt = "";
    let name = "";
    let draft = "";
    let currentFile = file;
    let choices: string[] = [];
    let confirmed = false;
    const generated = "Pi 插件已确认会话命名能从活动分支提取已验证的事实并生成三个候选，待补齐历史会话分支选择的回归测试以及确认取消时不会覆盖输入框中尚未提交的草稿内容，并核对候选名称始终标明 Pi 插件而不是使用泛化的仓库简称或把尚未完成的任务误写成已交付";
    assert.ok(generated.length > 80);
    const directTitle = "Pi 插件已验证活动分支命名，待补历史会话测试";
    const pi = { setSessionName(title: string) { name = title; } } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: { getSessionFile: () => currentFile, getBranch: () => branch, getCwd: () => "/work/pi-session-manager" },
      model: {},
      modelRegistry: {
        hasConfiguredAuth: () => true,
        complete: async (_model: unknown, context: { messages: { content: { text: string }[] }[] }) => {
          prompt = context.messages[0]!.content[0]!.text;
          return { content: [{ type: "text", text: prompt.includes("Suggest one short") ? directTitle : `1. ${generated}\n2. Pi 插件待补历史会话测试\n3. Pi 插件活动分支已验证，待回归` }] };
        },
      },
      ui: {
        notify() {},
        select: async (_label: string, options: string[]) => { choices = options; return options[0]; },
        getEditorText: () => draft,
        setEditorText: (value: string) => { draft = value; },
        confirm: async () => confirmed,
        editor: async (_label: string, prefill: string) => `${prefill} 手动微调`,
      },
      hasUI: true,
    } as unknown as ExtensionContext;
    await autonameSession(pi, ctx, undefined, { autonameMode: "review" });
    assert.match(prompt, /confirmed outcomes plus any meaningful next steps/);
    assert.match(prompt, /Don't invent a TODO from a request to preview or rename this session/);
    assert.match(prompt, /Verified: Pi autoname reads the active branch; TODO: test historical sessions/);
    assert.match(prompt, /Working directory: \/work\/pi-session-manager\nProject area hint: Pi 插件/);
    assert.doesNotMatch(prompt, /Abandoned TODO/);
    assert.deepEqual(choices, [generated, "Pi 插件待补历史会话测试", "Pi 插件活动分支已验证，待回归"]);
    assert.equal(draft, `/name ${generated}`);
    assert.equal(name, "");
    assert.equal(SessionManager.open(file).getSessionName(), undefined);

    draft = "unsent message";
    await autonameSession(pi, ctx, undefined, { autonameMode: "review" });
    assert.equal(draft, "unsent message");

    currentFile = "/other-session.jsonl";
    const target = { id: "session", file, cwd: "/work/pi-session-manager", updatedAt: 0 };
    await autonameSession(pi, ctx, target, { autonameMode: "review" });
    assert.equal(SessionManager.open(file).getSessionName(), `${generated} 手动微调`);
    assert.equal(name, "");

    currentFile = file;
    await autonameSession(pi, ctx, undefined, { autonameMode: "direct" });
    assert.equal(name, "");
    confirmed = true;
    await autonameSession(pi, ctx, undefined, { autonameMode: "direct" });
    assert.match(prompt, /Suggest one short, one-sentence session name/);
    assert.equal(name, directTitle);
    assert.equal(draft, "unsent message");

    currentFile = "/other-session.jsonl";
    await autonameSession(pi, ctx, target, { autonameMode: "direct" });
    assert.equal(SessionManager.open(file).getSessionName(), directTitle);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("autoname gives the model DNS and Nginx project context", async () => {
  for (const [cwd, task, area, hint] of [
    ["/work/dnsdb", "Confirmed DNS record exists; TODO: verify propagation", "DNS", true],
    ["/work/payby-nginx-pub-azure", "Updated Nginx vhost; TODO: run nginx -t", "Nginx", true],
    ["/work/infra", "Updated Nginx vhost; TODO: run nginx -t", "Nginx", false],
  ] as const) {
    const session = SessionManager.inMemory(cwd);
    session.appendMessage({ role: "user", content: task, timestamp: Date.now() });
    let prompt = "";
    let name = "";
    const pi = { setSessionName(title: string) { name = title; } } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: session,
      model: {},
      modelRegistry: {
        hasConfiguredAuth: () => true,
        complete: async (_model: unknown, context: { messages: { content: { text: string }[] }[] }) => {
          prompt = context.messages[0]!.content[0]!.text;
          return { content: [{ type: "text", text: `${area} 已核实配置，待验证` }] };
        },
      },
      ui: { notify() {}, confirm: async () => true },
      hasUI: true,
    } as unknown as ExtensionContext;
    await autonameSession(pi, ctx, undefined, { autonameMode: "direct" });
    assert.ok(prompt.includes(`Working directory: ${cwd}`));
    assert.ok(prompt.includes(task));
    assert.equal(prompt.includes(`Project area hint: ${area}`), hint);
    assert.match(prompt, /Nginx config: Ng\/Nginx/);
    assert.equal(name, `${area} 已核实配置，待验证`);
  }
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
