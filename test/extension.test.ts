import assert from "node:assert/strict";
import test from "node:test";

import register from "../src/index.js";

test("registers one native playwriter tool with expected actions", () => {
  const tools: Array<{ name: string; description?: string; parameters?: unknown }> = [];
  register({
    registerTool(tool: { name: string; description?: string; parameters?: unknown }) {
      tools.push(tool);
    },
  } as never);

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "playwriter");
  assert.match(tools[0]?.description ?? "", /update/u);
  assert.match(JSON.stringify(tools[0]?.parameters), /doctor/u);
});

test("version action invokes playwriter command and returns structured failure if unavailable", async () => {
  const tools: Array<{ name: string; execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }>; details: { action: string; ok: boolean } }> }> = [];
  register({ registerTool: (tool: (typeof tools)[number]) => tools.push(tool) } as never);

  const result = await tools[0]!.execute("1", { action: "version", timeoutMs: 1000 });
  assert.equal(result.details.action, "version");
  assert.equal(typeof result.details.ok, "boolean");
  assert.match(result.content[0]!.text, /\$ playwriter --version/u);
});

test("update action supports a non-mutating dry run", async () => {
  const tools: Array<{ execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }>; details: { action: string; ok: boolean } }> }> = [];
  register({ registerTool: (tool: (typeof tools)[number]) => tools.push(tool) } as never);

  const result = await tools[0]!.execute("1", { action: "update", dryRun: true });
  assert.equal(result.details.action, "update");
  assert.equal(result.details.ok, true);
  assert.match(result.content[0]!.text, /npm install --global playwriter@latest/u);
});

test("eval action redacts relay tokens from text and details", async () => {
  const tools: Array<{ execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }>; details: unknown }> }> = [];
  register({ registerTool: (tool: (typeof tools)[number]) => tools.push(tool) } as never);

  const result = await tools[0]!.execute("1", { action: "eval", code: "1", session: "demo", token: "SECRET_TOKEN", timeoutMs: 1 });
  assert.doesNotMatch(result.content[0]!.text, /SECRET_TOKEN/u);
  assert.doesNotMatch(JSON.stringify(result.details), /SECRET_TOKEN/u);
  assert.match(result.content[0]!.text, /--token '<redacted>'/u);
});
