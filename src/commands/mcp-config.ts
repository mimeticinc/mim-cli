import { spawn } from "node:child_process";

import { runtimeFromArgs } from "../runtime";

export function claudeMcpInstallCommand(project?: string): string[] {
  return [
    "claude",
    "mcp",
    "add",
    "--transport",
    "stdio",
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

export function codexMcpConfig(project?: string): string {
  const args = ["-y", "--package", "@mimeticinc/mim-cli", "mim-mcp", ...(project ? ["--project", project] : [])];
  return `[mcp_servers.mim]
command = "npx"
args = ${JSON.stringify(args)}
`;
}

export async function runMcp(args: string[]): Promise<void> {
  const [subcommand, target, ...rest] = args;
  const { project, args: kept } = runtimeFromArgs(rest);
  if (!subcommand) {
    console.log("Use `mim mcp install claude` or `mim mcp install codex`.");
    console.log("The MCP server exposes project-scoped growth context and recording review briefs without raw replay event dumps.");
    return;
  }
  if (subcommand !== "install") throw new Error(`unknown mcp command: ${subcommand}`);
  let runInstall = false;
  for (const arg of kept) {
    if (arg === "--run") runInstall = true;
    else throw new Error(`unknown mcp install option: ${arg}`);
  }
  if (target === "claude") {
    const command = claudeMcpInstallCommand(project);
    if (!runInstall) {
      console.log(command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`claude mcp add failed with exit code ${code}`))));
    });
    return;
  }
  if (target === "codex") {
    console.log(codexMcpConfig(project));
    return;
  }
  throw new Error("mcp install target must be claude or codex");
}
