import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionId, renderCommand, runCommand } from "../src/cli.js";

test("renderCommand quotes shell-unsafe arguments", () => {
  assert.equal(renderCommand("playwriter", ["--eval", "document.title"]), "playwriter --eval document.title");
  assert.equal(renderCommand("playwriter", ["--eval", "console.log('hi')"]), String.raw`playwriter --eval 'console.log('\''hi'\'')'`);
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
