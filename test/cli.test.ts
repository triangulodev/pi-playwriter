import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionId, redactCommandArgs, renderCommand, runCommand, runPlaywriterEval, runPlaywriterUpdate } from "../src/cli.js";

test("renderCommand quotes shell-unsafe arguments", () => {
  assert.equal(renderCommand("playwriter", ["--eval", "document.title"]), "playwriter --eval document.title");
  assert.equal(renderCommand("playwriter", ["--eval", "console.log('hi')"]), String.raw`playwriter --eval 'console.log('\''hi'\'')'`);
});

test("redactCommandArgs redacts sensitive flag values", () => {
  assert.deepEqual(redactCommandArgs(["--token", "SECRET_TOKEN", "--eval", "1"], ["--token"]), ["--token", "<redacted>", "--eval", "1"]);
  assert.deepEqual(redactCommandArgs(["--token=SECRET_TOKEN", "--eval", "1"], ["--token"]), ["--token=<redacted>", "--eval", "1"]);
});

test("parseSessionId accepts plain and labelled session output", () => {
  assert.equal(parseSessionId("abc-123\n"), "abc-123");
  assert.equal(parseSessionId("Session ID: my.session:1\n"), "my.session:1");
  assert.equal(parseSessionId(""), undefined);
});

test("runCommand captures successful output", async () => {
  const result = await runCommand(process.execPath, ["--version"]);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /^v\d+/u);
});

test("runCommand captures failed output without throwing", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(7)"]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "bad");
});

test("runPlaywriterEval does not disclose relay tokens in command output", async () => {
  const result = await runPlaywriterEval({ code: "1", session: "demo", token: "SECRET_TOKEN", timeoutMs: 1 });
  assert.doesNotMatch(result.result.command, /SECRET_TOKEN/u);
  assert.match(result.result.command, /--token '<redacted>'/u);
});

test("runPlaywriterUpdate rejects arbitrary package installs", async () => {
  await assert.rejects(() => runPlaywriterUpdate({ packageSpec: "left-pad", dryRun: true }), /only supports installing the playwriter package/u);
  await assert.rejects(() => runPlaywriterUpdate({ packageManager: "bash", dryRun: true }), /only supports the npm package manager/u);
});
