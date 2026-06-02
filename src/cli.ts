import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 24_000;

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ok: boolean;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  redactedArgNames?: readonly string[];
}

export interface EvalOptions extends RunCommandOptions {
  code: string;
  session?: string;
  host?: string;
  token?: string;
  autoCreateSession?: boolean;
}

export interface EvalResult {
  session?: string;
  createdSession: boolean;
  result: CommandResult;
}

export interface UpdateOptions extends RunCommandOptions {
  packageSpec?: string;
  packageManager?: string;
  global?: boolean;
  dryRun?: boolean;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  details?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… truncated ${text.length - MAX_OUTPUT_CHARS} chars`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function renderCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

export function redactCommandArgs(args: readonly string[], redactedArgNames: readonly string[]): string[] {
  const redacted = new Set(redactedArgNames);
  const result: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      result.push("<redacted>");
      redactNext = false;
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const flagName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    if (redacted.has(flagName)) {
      if (equalsIndex === -1) {
        result.push(arg);
        redactNext = true;
      } else {
        result.push(`${flagName}=<redacted>`);
      }
      continue;
    }

    result.push(arg);
  }

  return result;
}

function renderResultCommand(command: string, args: readonly string[], options: RunCommandOptions): string {
  return renderCommand(command, redactCommandArgs(args, options.redactedArgNames ?? []));
}

export async function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (command.includes("/") || command.includes("\\")) {
    try {
      await access(command);
      return true;
    } catch {
      return false;
    }
  }

  const pathValue = env.PATH ?? "";
  const pathExt = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const ext of pathExt) {
      try {
        await access(`${dir}/${command}${ext}`);
        return true;
      } catch {
        // try next path entry
      }
    }
  }
  return false;
}

export async function runCommand(command: string, args: string[], options: RunCommandOptions = {}): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: { ...process.env, ...options.env },
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true,
    });
    return {
      command: renderResultCommand(command, args, options),
      exitCode: 0,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      timedOut: false,
      ok: true,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string; signal?: string; killed?: boolean };
    return {
      command: renderResultCommand(command, args, options),
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: truncate(err.stdout ?? ""),
      stderr: truncate(err.stderr ?? err.message ?? ""),
      timedOut: err.killed === true || err.signal === "SIGTERM",
      ok: false,
    };
  }
}

function playwriterArgsForEval(options: { code: string; session: string; host?: string; token?: string; timeoutMs?: number }): string[] {
  const args: string[] = ["--session", options.session, "--eval", options.code];
  if (options.host) args.push("--host", options.host);
  if (options.token) args.push("--token", options.token);
  if (options.timeoutMs) args.push("--timeout", String(options.timeoutMs));
  return args;
}

export function parseSessionId(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const direct = trimmed.match(/^[A-Za-z0-9_.:-]+$/u);
  if (direct) return trimmed;
  const labelled = trimmed.match(/(?:session(?: id)?|id)\s*[:=]\s*([^\s]+)/iu);
  return labelled?.[1];
}

export async function runPlaywriterEval(options: EvalOptions): Promise<EvalResult> {
  let session = options.session;
  let createdSession = false;

  if (!session && options.autoCreateSession !== false) {
    const newSession = await runCommand("playwriter", ["session", "new"], options);
    if (!newSession.ok) {
      return { createdSession, result: newSession };
    }
    session = parseSessionId(newSession.stdout);
    createdSession = Boolean(session);
  }

  if (!session) {
    return {
      createdSession,
      result: {
        command: "playwriter --session <required> --eval <code>",
        exitCode: 2,
        stdout: "",
        stderr: "No Playwriter session was provided and a session could not be created. Run action=session_new or set autoCreateSession=true.",
        timedOut: false,
        ok: false,
      },
    };
  }

  return {
    session,
    createdSession,
    result: await runCommand("playwriter", playwriterArgsForEval({ ...options, session }), { ...options, redactedArgNames: ["--token"] }),
  };
}

function validateUpdatePackageManager(packageManager: string): void {
  if (!/^npm(?:\.cmd)?$/iu.test(packageManager)) {
    throw new Error("action=update only supports the npm package manager.");
  }
}

function validateUpdatePackageSpec(packageSpec: string): void {
  if (!/^playwriter(?:@[A-Za-z0-9._~^*<>=+-]+)?$/u.test(packageSpec)) {
    throw new Error("action=update only supports installing the playwriter package.");
  }
}

export async function runPlaywriterUpdate(options: UpdateOptions = {}): Promise<CommandResult> {
  const packageManager = options.packageManager ?? "npm";
  const packageSpec = options.packageSpec ?? "playwriter@latest";
  validateUpdatePackageManager(packageManager);
  validateUpdatePackageSpec(packageSpec);
  const args = options.global === false ? ["install", packageSpec] : ["install", "--global", packageSpec];
  if (options.dryRun) {
    return {
      command: renderCommand(packageManager, args),
      exitCode: 0,
      stdout: "Dry run: update command was constructed but not executed.",
      stderr: "",
      timedOut: false,
      ok: true,
    };
  }
  return runCommand(packageManager, args, options);
}

function check(name: string, result: CommandResult, successMessage: string, failureHint: string): DoctorCheck {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return {
    name,
    ok: result.ok,
    message: result.ok ? successMessage : failureHint,
    details: output || result.command,
  };
}

export async function runPlaywriterDoctor(options: RunCommandOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  const node = await runCommand("node", ["--version"], options);
  checks.push(check("node", node, "Node.js is available.", "Node.js is not available on PATH."));

  const npm = await runCommand("npm", ["--version"], options);
  checks.push(check("npm", npm, "npm is available.", "npm is not available on PATH; Playwriter updates need npm or an explicit packageManager."));

  const hasPlaywriter = await commandExists("playwriter", { ...process.env, ...options.env });
  checks.push({
    name: "playwriter_on_path",
    ok: hasPlaywriter,
    message: hasPlaywriter ? "playwriter is on PATH." : "playwriter is not on PATH; install with `npm install --global playwriter` or run the update action.",
  });

  const version = await runCommand("playwriter", ["--version"], options);
  checks.push(check("playwriter_version", version, "Playwriter reports a version.", "Playwriter is not runnable."));

  const help = await runCommand("playwriter", ["--help"], options);
  checks.push(check("playwriter_help", help, "Playwriter help is readable.", "Playwriter help failed; the CLI installation may be broken."));

  const latest = await runCommand("npm", ["view", "playwriter", "version"], { ...options, timeoutMs: Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 15_000) });
  checks.push(check("npm_latest", latest, "Latest npm Playwriter version can be resolved.", "Could not resolve latest Playwriter from npm; check network/npm registry access."));

  if (version.ok && latest.ok) {
    const installed = version.stdout.trim().replace(/^playwriter\//u, "");
    const remote = latest.stdout.trim();
    checks.push({
      name: "playwriter_current",
      ok: installed === remote,
      message: installed === remote ? "Installed Playwriter matches npm latest." : `Installed Playwriter (${installed}) differs from npm latest (${remote}); run action=update if you want latest.`,
    });
  }

  const sessions = await runCommand("playwriter", ["session", "list"], options);
  checks.push(check("session_list", sessions, "Playwriter can list sessions.", "Playwriter session listing failed; browser relay/session state may be unavailable."));

  const skill = await runCommand("playwriter", ["skill"], options);
  checks.push(check("skill", skill, "Playwriter usage instructions are available.", "Could not read Playwriter skill instructions."));

  if (process.env.PLAYWRITER_HOST) {
    checks.push({ name: "PLAYWRITER_HOST", ok: true, message: `PLAYWRITER_HOST is set to ${process.env.PLAYWRITER_HOST}.` });
  }
  if (process.env.PLAYWRITER_TOKEN) {
    checks.push({ name: "PLAYWRITER_TOKEN", ok: true, message: "PLAYWRITER_TOKEN is set." });
  }

  return { ok: checks.every((item) => item.ok), checks };
}
