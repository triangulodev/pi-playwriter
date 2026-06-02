# Security Findings

## Token disclosure in `eval` command output

Status: fixed

Severity: medium

Affected code:

- `src/index.ts` exposes `token` as a tool parameter for `action=eval`.
- `src/index.ts` passes that value into `runPlaywriterEval`.
- `src/cli.ts` appends the token to the Playwriter CLI arguments as `--token <value>`.
- `src/index.ts` returns `formatCommandResult(evalResult.result)` to the caller and also includes the full `CommandResult` in `details.command`.

### Issue

When a caller supplies `token`, the extension returns the complete rendered command string. Because the rendered command includes `--token <value>`, the relay token is disclosed in the tool response and structured result details.

This leaks a credential into any place that stores or displays tool results, such as agent transcripts, debug logs, telemetry, issue reports, or copied error output. The leak occurs even when the underlying `playwriter` command fails, because the command string is constructed before returning the failure result.

### Evidence

The vulnerable flow is:

1. `src/index.ts` defines `token` as "Remote Playwriter relay token" in the tool schema.
2. `src/index.ts` forwards `params.token` into `runPlaywriterEval`.
3. `src/cli.ts` builds Playwriter arguments with `args.push("--token", options.token)`.
4. `src/cli.ts` stores `renderCommand(command, args)` in `CommandResult.command`.
5. `src/index.ts` prints the command through `formatCommandResult` and returns the full command result in `details.command`.

Reproduction from this repository:

```bash
node --import tsx --input-type=module -e "import { runPlaywriterEval } from './src/cli.ts'; const r = await runPlaywriterEval({ code: '1', session: 'demo', token: 'SECRET_TOKEN', timeoutMs: 1 }); console.log(r.result.command);"
```

Observed output:

```text
playwriter --session demo --eval 1 --token SECRET_TOKEN --timeout 1
```

Fixed behavior:

```text
playwriter --session demo --eval 1 --token '<redacted>' --timeout 1
```

### Impact

An exposed Playwriter relay token may allow unauthorized use of the configured remote relay, depending on relay authorization semantics. Even if the relay has limited access, the token should be treated as secret because the extension names it as a token and accepts it as authentication material.

The most likely exploit path is prompt or tool-call manipulation that causes a user to pass a real token, followed by disclosure through the normal tool response. The attacker does not need shell injection or a successful Playwriter invocation; they only need access to the resulting transcript or logs.

### Fix

Sensitive arguments are now redacted before storing or returning rendered command strings. The real token is still passed to `execFile`, but `CommandResult.command` renders `--token <redacted>`.

Regression coverage:

- `runPlaywriterEval` with `token: "SECRET_TOKEN"` asserts that the returned command does not contain the secret.
- `redactCommandArgs` covers both `--token SECRET_TOKEN` and `--token=SECRET_TOKEN`.

Recommended follow-up hardening:

- Avoid echoing any future credential-bearing flags in command output.
- Prefer environment variables or a secret channel for relay tokens when the host platform supports secret parameters.

### Related observation

The `update` action previously accepted caller-controlled `packageSpec` and `packageManager` values and executed an npm install by default. This was a high-trust operation because npm install lifecycle scripts can execute code on the host.

Status: fixed

The updater now rejects non-npm package managers and package specs outside the intended `playwriter` package. Regression coverage asserts that `packageSpec: "left-pad"` and `packageManager: "bash"` are rejected before any install command is constructed.
