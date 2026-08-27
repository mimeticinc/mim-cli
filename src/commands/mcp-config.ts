import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { MimRuntime, runtimeFromArgs } from "../runtime";
import { homeDir } from "../util";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

export const EXIT_COMMAND_NOT_FOUND = 127;

export function execCommand(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => resolve({ code: EXIT_COMMAND_NOT_FOUND, stdout, stderr: stderr || "command not found" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

// User scope on purpose: the default `claude mcp add` scope is local, which
// registers the server only for the directory the command ran in. Users then
// open Claude Code in their own project, see no mim server, and conclude the
// install failed.
export function claudeMcpInstallCommand(project?: string): string[] {
  return [
    "claude",
    "mcp",
    "add",
    "--transport",
    "stdio",
    "--scope",
    "user",
    "mim",
    "--",
    "npx",
    "-y",
    "--package",
    "@mimeticinc/mim-cli",
    "mim-mcp",
    ...(project ? ["--project", project] : []),
  ];
}

export function mimMcpServerEntry(project?: string): { command: string; args: string[] } {
  return {
    command: "npx",
    args: ["-y", "--package", "@mimeticinc/mim-cli", "mim-mcp", ...(project ? ["--project", project] : [])],
  };
}

export function codexMcpConfig(project?: string): string {
  const args = ["-y", "--package", "@mimeticinc/mim-cli", "mim-mcp", ...(project ? ["--project", project] : [])];
  return `[mcp_servers.mim]
command = "npx"
args = ${JSON.stringify(args)}
`;
}

export function cursorConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), ".cursor", "mcp.json");
}

export function windsurfConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), ".codeium", "windsurf", "mcp_config.json");
}

export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), ".codex", "config.toml");
}

export function claudeDesktopConfigPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  const home = homeDir(env);
  if (platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "Claude", "claude_desktop_config.json");
}

// Pure merge so it is testable and so a bug can never eat someone's config:
// every existing key and every existing MCP server is preserved verbatim.
export function mergeMcpServersConfig(existingText: string | null, project?: string): string {
  let parsed: Record<string, unknown> = {};
  if (existingText && existingText.trim()) {
    const value = JSON.parse(existingText) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("existing config root is not a JSON object");
    }
    parsed = value as Record<string, unknown>;
  }
  const existingServers = parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
    ? (parsed.mcpServers as Record<string, unknown>)
    : {};
  const merged = { ...parsed, mcpServers: { ...existingServers, mim: mimMcpServerEntry(project) } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

export type RegisterOutcome = {
  status: "registered" | "already" | "cli_missing" | "failed";
  lines: string[];
};

// Registers the mim server with Claude Code and then reads it back through
// `claude mcp get`, because `claude mcp add` exiting 0 does not prove the
// entry landed where the user's sessions will look for it.
export async function registerClaudeCodeMcp(project: string, exec: ExecFn = execCommand): Promise<RegisterOutcome> {
  const version = await exec("claude", ["--version"]);
  if (version.code === EXIT_COMMAND_NOT_FOUND) {
    return { status: "cli_missing", lines: ["The `claude` command was not found on this machine."] };
  }

  const existing = await exec("claude", ["mcp", "get", "mim"]);
  if (existing.code === 0) {
    return {
      status: "already",
      lines: [
        "Claude Code already has a mim MCP server registered; left it in place.",
        "To re-register from scratch: claude mcp remove mim, then run this again.",
      ],
    };
  }

  const add = await exec("claude", claudeMcpInstallCommand(project).slice(1));
  if (add.code !== 0 && !/already exists/i.test(`${add.stdout}${add.stderr}`)) {
    const detail = (add.stderr || add.stdout).trim().slice(0, 300);
    return {
      status: "failed",
      lines: [
        `\`claude mcp add\` failed with exit code ${add.code}${detail ? `: ${detail}` : ""}.`,
        "Run this by hand to see the full error:",
        `  ${claudeMcpInstallCommand(project).map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")}`,
      ],
    };
  }

  const verify = await exec("claude", ["mcp", "get", "mim"]);
  if (verify.code !== 0) {
    return {
      status: "failed",
      lines: [
        "`claude mcp add` reported success, but `claude mcp get mim` cannot see the server.",
        "Run `claude mcp list` to inspect what Claude Code has registered.",
      ],
    };
  }
  return {
    status: "registered",
    lines: ["Registered the mim MCP server with Claude Code at user scope (available in every project)."],
  };
}

export type DesktopOutcome = {
  status: "written" | "not_installed" | "failed";
  lines: string[];
};

export function installClaudeDesktopMcp(project: string, configPath = claudeDesktopConfigPath()): DesktopOutcome {
  return installJsonMcpAgent("Claude Desktop", configPath, project);
}

export function installCursorMcp(project: string, configPath = cursorConfigPath()): DesktopOutcome {
  return installJsonMcpAgent("Cursor", configPath, project);
}

export function installWindsurfMcp(project: string, configPath = windsurfConfigPath()): DesktopOutcome {
  return installJsonMcpAgent("Windsurf", configPath, project);
}

// Codex writes TOML rather than the mcpServers object, so it has its own
// writer. Same contract as the JSON one: back up, write, read back.
export function installCodexMcp(project: string, configPath = codexConfigPath()): DesktopOutcome {
  const existingText = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
  if (existingText !== null && /^\s*\[mcp_servers\.mim\]\s*$/m.test(existingText)) {
    return { status: "written", lines: [`Codex already has the mim server (${configPath}).`] };
  }
  const merged = mergeCodexConfig(existingText, project);
  if (existingText !== null) copyFileSync(configPath, `${configPath}.bak`);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, merged);
  if (!/^\s*\[mcp_servers\.mim\]\s*$/m.test(readFileSync(configPath, "utf8"))) {
    return { status: "failed", lines: [`Wrote ${configPath}, but the mim entry did not read back. Inspect the file by hand.`] };
  }
  return {
    status: "written",
    lines: [
      `Added the mim server to Codex config: ${configPath}`,
      ...(existingText !== null ? [`Previous config backed up to ${configPath}.bak`] : []),
      "Restart Codex to load it.",
    ],
  };
}

export function installJsonMcpAgent(label: string, configPath: string, project: string): DesktopOutcome {
  if (!existsSync(dirname(configPath))) {
    return { status: "not_installed", lines: [`${label} does not look installed (no ${dirname(configPath)}).`] };
  }
  const existingText = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
  let merged: string;
  try {
    merged = mergeMcpServersConfig(existingText, project);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      lines: [
        `Could not update ${configPath}: ${detail}.`,
        "Fix or remove that file, then run this again. Nothing was changed.",
      ],
    };
  }
  if (existingText !== null) copyFileSync(configPath, `${configPath}.bak`);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, merged);

  const written = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers?: Record<string, unknown> };
  if (!written.mcpServers || !written.mcpServers.mim) {
    return { status: "failed", lines: [`Wrote ${configPath}, but the mim entry did not read back. Inspect the file by hand.`] };
  }
  return {
    status: "written",
    lines: [
      `Added the mim server to ${label} config: ${configPath}`,
      ...(existingText !== null ? [`Previous config backed up to ${configPath}.bak`] : []),
      `Restart ${label} to load it.`,
    ],
  };
}

// Codex keeps TOML, so this appends the table instead of reparsing and
// rewriting the file. Re-emitting somebody's config to add one entry risks
// dropping their comments and ordering, and this file is not ours to reformat.
export function mergeCodexConfig(existingText: string | null, project?: string): string {
  const block = codexMcpConfig(project).trimEnd();
  if (!existingText || !existingText.trim()) return `${block}\n`;
  if (/^\s*\[mcp_servers\.mim\]\s*$/m.test(existingText)) return existingText;
  const base = existingText.endsWith("\n") ? existingText : `${existingText}\n`;
  return `${base}\n${block}\n`;
}

export type AgentKind = "claude" | "codex" | "cursor" | "windsurf" | "desktop";

export type DetectedAgent = { kind: AgentKind; label: string };

// Which agents this machine actually has, so setup can wire the one somebody
// uses instead of assuming Claude Code. Detection is by config directory
// rather than by running each binary: it is instant, needs nothing on PATH,
// and a directory is what these tools create on first run. Claude Code is the
// exception, since it registers through its own CLI.
export function detectAgentDirs(env: NodeJS.ProcessEnv = process.env): DetectedAgent[] {
  const found: DetectedAgent[] = [];
  const home = homeDir(env);
  if (existsSync(join(home, ".codex"))) found.push({ kind: "codex", label: "Codex" });
  if (existsSync(join(home, ".cursor"))) found.push({ kind: "cursor", label: "Cursor" });
  if (existsSync(join(home, ".codeium", "windsurf"))) found.push({ kind: "windsurf", label: "Windsurf" });
  if (existsSync(dirname(claudeDesktopConfigPath(process.platform, env)))) {
    found.push({ kind: "desktop", label: "Claude Desktop" });
  }
  return found;
}

// Register with every agent found, so a Codex or Cursor user is not left
// pasting a config block that the page told them to go find.
export function installDetectedAgents(project: string, agents: DetectedAgent[]): { label: string; outcome: DesktopOutcome }[] {
  return agents.map((agent) => {
    if (agent.kind === "codex") return { label: agent.label, outcome: installCodexMcp(project) };
    if (agent.kind === "cursor") return { label: agent.label, outcome: installCursorMcp(project) };
    if (agent.kind === "windsurf") return { label: agent.label, outcome: installWindsurfMcp(project) };
    return { label: agent.label, outcome: installClaudeDesktopMcp(project) };
  });
}

export type McpProbe = { ok: boolean; toolCount: number; detail: string };

// End-to-end check that the hosted MCP endpoint answers this token. This is
// the same wire call an MCP client makes, so a pass here means the registered
// server will actually work once the client starts it.
export async function probeMimMcpEndpoint(
  runtime: Pick<MimRuntime, "apiBaseUrl" | "token" | "traceId">,
  fetchImpl: typeof fetch = fetch,
): Promise<McpProbe> {
  try {
    const response = await fetchImpl(`${runtime.apiBaseUrl}/api/mim/mcp`, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${runtime.token}`,
        "content-type": "application/json",
        "x-mim-client": "mim-cli",
        "x-mim-trace-id": runtime.traceId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "mim-setup-probe", method: "tools/list" }),
    });
    if (!response.ok) {
      return { ok: false, toolCount: 0, detail: `the MCP endpoint answered with HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { result?: { tools?: unknown[] } };
    const toolCount = Array.isArray(payload.result?.tools) ? payload.result.tools.length : 0;
    if (toolCount === 0) return { ok: false, toolCount: 0, detail: "the MCP endpoint answered but returned no tools" };
    return { ok: true, toolCount, detail: `the MCP endpoint answered with ${toolCount} tools` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, toolCount: 0, detail: `could not reach the MCP endpoint: ${detail}` };
  }
}

export async function installClaudeMcp(project: string, runtime: MimRuntime, exec: ExecFn = execCommand): Promise<void> {
  const outcome = await registerClaudeCodeMcp(project, exec);
  for (const line of outcome.lines) console.log(line);

  if (outcome.status === "cli_missing") {
    const desktop = installClaudeDesktopMcp(project);
    for (const line of desktop.lines) console.log(line);
    if (desktop.status === "not_installed") {
      console.log("For Claude Code, install it first (https://claude.com/claude-code), then run `mim mcp install claude` again.");
      console.log("For any other MCP client, add this server entry:");
      console.log(JSON.stringify({ mcpServers: { mim: mimMcpServerEntry(project) } }, null, 2));
      process.exitCode = 1;
      return;
    }
    if (desktop.status === "failed") {
      process.exitCode = 1;
      return;
    }
  }
  if (outcome.status === "failed") {
    process.exitCode = 1;
    return;
  }

  if (!runtime.token) {
    console.log("Not signed in yet, so the server will fail to start. Run `mim auth login` to finish setup.");
    return;
  }
  const probe = await probeMimMcpEndpoint(runtime);
  if (probe.ok) {
    console.log(`Verified: ${probe.detail}.`);
  } else {
    console.log(`Registration is in place, but ${probe.detail}.`);
    console.log("Run `mim auth status` to check credentials, then try again.");
    process.exitCode = 1;
  }
}

export async function runMcp(args: string[]): Promise<void> {
  const [subcommand, target, ...rest] = args;
  const { runtime, project, args: kept } = runtimeFromArgs(rest);
  if (!subcommand) {
    console.log("New machine? `mim setup` does login, MCP registration, and verification in one go.");
    console.log("Or register only the MCP server:");
    console.log("  mim mcp install claude     Claude Code (falls back to Claude Desktop)");
    console.log("  mim mcp install codex      Codex (~/.codex/config.toml)");
    console.log("  mim mcp install cursor     Cursor (~/.cursor/mcp.json)");
    console.log("  mim mcp install windsurf   Windsurf");
    console.log("  mim mcp install desktop    Claude Desktop config file");
    console.log("  mim mcp install all        Every agent found on this machine");
    console.log("The MCP server exposes project-scoped growth context and recording review briefs without raw replay event dumps.");
    return;
  }
  if (subcommand !== "install") throw new Error(`unknown mcp command: ${subcommand}`);
  let printOnly = false;
  for (const arg of kept) {
    if (arg === "--print") printOnly = true;
    else if (arg === "--run") printOnly = false;
    else throw new Error(`unknown mcp install option: ${arg}`);
  }
  if (target === "claude") {
    if (printOnly) {
      console.log(claudeMcpInstallCommand(project).map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "));
      return;
    }
    await installClaudeMcp(project, runtime);
    return;
  }
  if (target === "desktop") {
    const desktop = installClaudeDesktopMcp(project);
    for (const line of desktop.lines) console.log(line);
    if (desktop.status !== "written") process.exitCode = 1;
    return;
  }
  if (target === "codex" || target === "cursor" || target === "windsurf") {
    if (printOnly) {
      console.log(target === "codex"
        ? codexMcpConfig(project)
        : JSON.stringify({ mcpServers: { mim: mimMcpServerEntry(project) } }, null, 2));
      return;
    }
    const outcome = target === "codex"
      ? installCodexMcp(project)
      : target === "cursor" ? installCursorMcp(project) : installWindsurfMcp(project);
    for (const line of outcome.lines) console.log(line);
    if (outcome.status !== "written") process.exitCode = 1;
    return;
  }
  if (target === "all") {
    const agents = detectAgentDirs();
    if (!agents.length) {
      console.log("No agent config directories found for Codex, Cursor, Windsurf or Claude Desktop.");
      console.log("For Claude Code run: mim mcp install claude");
      return;
    }
    for (const { label, outcome } of installDetectedAgents(project, agents)) {
      for (const line of outcome.lines) console.log(`${label}: ${line}`);
      if (outcome.status !== "written") process.exitCode = 1;
    }
    return;
  }
  throw new Error("mcp install target must be claude, codex, cursor, windsurf, desktop, or all");
}
