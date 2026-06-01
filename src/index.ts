import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  runCommand,
  runPlaywriterDoctor,
  runPlaywriterEval,
  runPlaywriterUpdate,
  type CommandResult,
  type DoctorResult,
} from "./cli.js";

const Action = Type.Union([
  Type.Literal("eval"),
  Type.Literal("session_new"),
  Type.Literal("session_list"),
  Type.Literal("session_delete"),
  Type.Literal("session_reset"),
  Type.Literal("skill"),
  Type.Literal("logfile"),
  Type.Literal("version"),
  Type.Literal("update"),
  Type.Literal("doctor"),
]);

const PlaywriterParams = Type.Object({
  action: Type.Optional(Action),
  code: Type.Optional(Type.String({ description: "JavaScript to pass to `playwriter --eval`. Required for action=eval." })),
  session: Type.Optional(Type.String({ description: "Playwriter session id/name for eval, session_delete, or session_reset." })),
  autoCreateSession: Type.Optional(Type.Boolean({ description: "For eval without session, create a Playwriter session first. Defaults to true." })),
  host: Type.Optional(Type.String({ description: "Remote Playwriter relay host, equivalent to --host or PLAYWRITER_HOST." })),
  token: Type.Optional(Type.String({ description: "Remote Playwriter relay token, equivalent to --token or PLAYWRITER_TOKEN." })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Tool execution timeout in milliseconds. Defaults to 10000." })),
  packageSpec: Type.Optional(Type.String({ description: "Package spec for action=update. Defaults to playwriter@latest." })),
  packageManager: Type.Optional(Type.String({ description: "Package manager executable for action=update. Defaults to npm." })),
  global: Type.Optional(Type.Boolean({ description: "Use global package install for action=update. Defaults to true." })),
  dryRun: Type.Optional(Type.Boolean({ description: "For action=update, construct and return the update command without executing it." })),
});

type PlaywriterAction =
  | "eval"
  | "session_new"
  | "session_list"
  | "session_delete"
  | "session_reset"
  | "skill"
  | "logfile"
  | "version"
  | "update"
  | "doctor";

type PlaywriterParams = {
  action?: PlaywriterAction;
  code?: string;
  session?: string;
  autoCreateSession?: boolean;
  host?: string;
  token?: string;
  timeoutMs?: number;
  packageSpec?: string;
  packageManager?: string;
  global?: boolean;
  dryRun?: boolean;
};

type Details = {
  action: PlaywriterAction;
  ok: boolean;
  command?: CommandResult;
  session?: string;
  createdSession?: boolean;
  doctor?: DoctorResult;
};

function definedOptions<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function textResult(text: string, details: Details): AgentToolResult<Details> {
  return { content: [{ type: "text", text }], details };
}

function formatCommandResult(result: CommandResult): string {
  const parts = [`$ ${result.command}`, `exit: ${result.exitCode ?? (result.timedOut ? "timeout" : "unknown")}`];
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
  return parts.join("\n");
}

function formatDoctor(result: DoctorResult): string {
  return result.checks
    .map((item) => {
      const status = item.ok ? "✅" : "❌";
      return [`${status} ${item.name}: ${item.message}`, item.details ? `   ${item.details.replaceAll("\n", "\n   ")}` : undefined]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function requireSession(action: PlaywriterAction, params: PlaywriterParams): string {
  if (!params.session) throw new Error(`action=${action} requires a session parameter.`);
  return params.session;
}

function resolveAction(params: PlaywriterParams): PlaywriterAction {
  if (params.action) return params.action;
  return params.code ? "eval" : "doctor";
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "playwriter",
    label: "Playwriter",
    description:
      "Native Pi tool for the Playwriter CLI. Use it to evaluate Playwriter JavaScript, manage sessions, read Playwriter usage instructions, update the CLI, and doctor installation issues.",
    promptSnippet:
      "Use playwriter for browser-control tasks through the Playwriter CLI. Prefer action=doctor when setup is uncertain; use action=update to install or refresh the CLI; use action=eval with JavaScript for browser operations.",
    promptGuidelines: [
      "Do not guess that Playwriter is installed; run action=doctor when setup is uncertain.",
      "For action=eval, provide code and either a session or allow autoCreateSession to create one.",
      "If action=update changes the installation, run action=doctor afterward before relying on Playwriter.",
      "Treat failed doctor checks as actionable setup diagnostics, not as successful browser automation.",
    ],
    parameters: PlaywriterParams,
    async execute(_toolCallId, rawParams: PlaywriterParams) {
      const params = rawParams ?? {};
      const action = resolveAction(params);
      const timeoutMs = params.timeoutMs;

      if (action === "doctor") {
        const doctor = await runPlaywriterDoctor(definedOptions({ timeoutMs }));
        return textResult(formatDoctor(doctor), { action, ok: doctor.ok, doctor });
      }

      if (action === "update") {
        const command = await runPlaywriterUpdate(
          definedOptions({
            timeoutMs,
            packageSpec: params.packageSpec,
            packageManager: params.packageManager,
            global: params.global,
            dryRun: params.dryRun,
          }),
        );
        return textResult(formatCommandResult(command), { action, ok: command.ok, command });
      }

      if (action === "eval") {
        if (!params.code) throw new Error("action=eval requires a code parameter.");
        const evalResult = await runPlaywriterEval(
          definedOptions({
            code: params.code,
            session: params.session,
            host: params.host,
            token: params.token,
            timeoutMs,
            autoCreateSession: params.autoCreateSession,
          }) as { code: string; session?: string; host?: string; token?: string; timeoutMs?: number; autoCreateSession?: boolean },
        );
        const prefix = evalResult.session ? `session: ${evalResult.session}${evalResult.createdSession ? " (created)" : ""}\n` : "";
        return textResult(
          `${prefix}${formatCommandResult(evalResult.result)}`,
          definedOptions({
            action,
            ok: evalResult.result.ok,
            command: evalResult.result,
            session: evalResult.session,
            createdSession: evalResult.createdSession,
          }) as Details,
        );
      }

      const commandArgs: string[] = [];
      switch (action) {
        case "session_new":
          commandArgs.push("session", "new");
          break;
        case "session_list":
          commandArgs.push("session", "list");
          break;
        case "session_delete":
          commandArgs.push("session", "delete", requireSession(action, params));
          break;
        case "session_reset":
          commandArgs.push("session", "reset", requireSession(action, params));
          break;
        case "skill":
          commandArgs.push("skill");
          break;
        case "logfile":
          commandArgs.push("logfile");
          break;
        case "version":
          commandArgs.push("--version");
          break;
      }

      const command = await runCommand("playwriter", commandArgs, definedOptions({ timeoutMs }));
      return textResult(formatCommandResult(command), { action, ok: command.ok, command });
    },
  });
}
