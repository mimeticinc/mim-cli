import { accessSync, constants } from "node:fs";
import { join } from "node:path";

import { MIM_CLIENT_VERSION, saveMimConfig } from "../config";
import { runtimeFromArgs } from "../runtime";
import { trackMimUsageEvent } from "../telemetry";
import { noProjectsGuidance, summarizeProjects } from "../account";
import { LoginResult, ensureLoggedIn } from "./auth";
import {
  ExecFn,
  execCommand,
  installClaudeDesktopMcp,
  probeMimMcpEndpoint,
  registerClaudeCodeMcp,
} from "./mcp-config";

export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const separator = platform === "win32" ? ";" : ":";
  const extensions = platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of (env.PATH || "").split(separator)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return "";
}

// The exact PATH repair for this user's shell. "mim: command not found" after
// a successful global install almost always means npm's global bin directory
// is not on PATH (nvm not loaded in this shell, or a custom npm prefix).
export function pathFixLines(shell: string, npmBinDir: string): string[] {
  const profile = shell.endsWith("zsh") ? "~/.zshrc" : shell.endsWith("bash") ? "~/.bashrc" : "your shell profile";
  const binDir = npmBinDir || "$(npm prefix -g)/bin";
  return [
    "note: the `mim` command is not on your shell PATH.",
    "npx always works without PATH changes: npx -y @mimeticinc/mim-cli <command>",
    "To make `mim` itself work, install it globally:",
    "  npm install -g @mimeticinc/mim-cli",
    `If it is installed and still not found, npm's bin directory is missing from PATH. Add this line to ${profile}:`,
    `  export PATH="${binDir}:$PATH"`,
    "Then open a new terminal (or run `exec $SHELL`).",
  ];
}

async function npmGlobalBinDir(exec: ExecFn): Promise<string> {
  const result = await exec("npm", ["prefix", "-g"]);
  const prefix = result.code === 0 ? result.stdout.trim() : "";
  if (!prefix) return "";
  return process.platform === "win32" ? prefix : join(prefix, "bin");
}

export async function runSetup(args: string[], exec: ExecFn = execCommand): Promise<void> {
  const { runtime, project: requestedProject, args: kept } = runtimeFromArgs(args);
  let noOpen = false;
  let forceLogin = false;
  for (const arg of kept) {
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--force") forceLogin = true;
    else throw new Error(`unknown setup option: ${arg}`);
  }

  const say = (line = "") => console.log(line);
  const failures: string[] = [];

  say(`mim setup (v${MIM_CLIENT_VERSION})`);

  say();
  say("1/4 Install check");
  say(`  ok: mim ${MIM_CLIENT_VERSION} on Node ${process.versions.node}`);
  const mimPath = findOnPath("mim");
  if (mimPath) {
    say(`  ok: the \`mim\` command resolves to ${mimPath}`);
  } else {
    const binDir = await npmGlobalBinDir(exec);
    for (const line of pathFixLines(process.env.SHELL || "", binDir)) say(`  ${line}`);
  }

  say();
  say("2/4 Sign in");
  let session: LoginResult | null = null;
  try {
    session = await ensureLoggedIn(runtime, { noOpen, force: forceLogin, log: (line) => say(`  ${line}`) });
    const who = session.email || "(token configured)";
    say(`  ok: signed in as ${who}${session.reused ? " (existing login reused, no new token created)" : ""}`);
  } catch (error) {
    failures.push("sign in");
    say(`  failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  say();
  say("3/4 Projects");
  let defaultProject = "";
  if (!session) {
    say("  skipped: needs a working sign-in.");
  } else if (session.projects.length === 0) {
    for (const line of noProjectsGuidance(session.email)) say(`  ${line}`);
  } else {
    const plural = session.projects.length === 1 ? "project" : "projects";
    say(`  ok: ${session.projects.length} ${plural}: ${summarizeProjects(session.projects)}`);
    defaultProject = session.defaultProject;
    if (requestedProject) {
      const match = session.projects.find((candidate) => candidate.key === requestedProject);
      if (match) {
        saveMimConfig({ ...session.runtime.config, defaultProject: match.key });
        defaultProject = match.key;
      } else {
        say(`  note: --project ${requestedProject} is not in this account's project list; ignoring it.`);
      }
    }
    if (defaultProject) {
      say(`  ok: default project is ${defaultProject}`);
    } else {
      say("  note: no default project set. Pick one with `mim projects use <key>`.");
    }
  }

  say();
  say("4/4 MCP for Claude Code");
  if (!session) {
    say("  skipped: needs a working sign-in.");
  } else {
    const registration = await registerClaudeCodeMcp(defaultProject, exec);
    let registered = registration.status === "registered" || registration.status === "already";
    registration.lines.forEach((line, index) => {
      say(`  ${registered && index === 0 ? "ok: " : ""}${line}`);
    });
    if (registration.status === "cli_missing") {
      const desktop = installClaudeDesktopMcp(defaultProject);
      for (const line of desktop.lines) say(`  ${line}`);
      registered = desktop.status === "written";
      if (!registered) {
        say("  For Claude Code, install it first (https://claude.com/claude-code), then run `mim mcp install claude`.");
      }
    }
    if (!registered) failures.push("MCP registration");

    const probe = await probeMimMcpEndpoint(session.runtime);
    if (probe.ok) {
      say(`  ok: ${probe.detail}`);
    } else {
      failures.push("MCP endpoint check");
      say(`  failed: ${probe.detail}`);
      say("  Run `mim auth status` to check credentials, then run `mim setup` again.");
    }
  }

  say();
  if (failures.length > 0) {
    say(`Setup is not finished. Fix the failed step${failures.length > 1 ? "s" : ""} (${failures.join(", ")}) and run \`mim setup\` again. Re-running is safe.`);
    process.exitCode = 1;
  } else if (session && session.projects.length > 0) {
    const key = defaultProject || (session.projects.length === 1 ? session.projects[0].key : "");
    say("Done. Open a new Claude Code session and ask:");
    if (key) {
      say(`  "What is holding growth back on ${key}?"`);
      say(`Or try it right here: mim context --project ${key}`);
    } else {
      say('  "What is holding growth back on my site?"');
      say("Or pick a default project first: mim projects use <key>");
    }
  } else if (session) {
    say("Setup finished, but this account has no projects yet. See the step above for how to link one.");
  }

  if (session) {
    await trackMimUsageEvent(session.runtime, {
      event: "cli_command",
      client: "mim-cli",
      command: "setup",
      status: failures.length ? "failure" : "success",
      metadata: { failures },
    });
  }
}
