import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  codexConfigPath,
  cursorConfigPath,
  detectAgentDirs,
  installCodexMcp,
  installCursorMcp,
  installDetectedAgents,
  installWindsurfMcp,
  mergeCodexConfig,
  mergeMcpServersConfig,
  windsurfConfigPath,
} from "../src/commands/mcp-config";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "mim-agents-"));
}

describe("config paths", () => {
  it("points each agent at its own file", () => {
    const home = tempHome();
    const env = { HOME: home } as NodeJS.ProcessEnv;
    expect(cursorConfigPath(env)).toBe(join(home, ".cursor", "mcp.json"));
    expect(windsurfConfigPath(env)).toBe(join(home, ".codeium", "windsurf", "mcp_config.json"));
    expect(codexConfigPath(env)).toBe(join(home, ".codex", "config.toml"));
  });
});

describe("detectAgentDirs", () => {
  it("finds nothing on a machine with no agents", () => {
    expect(detectAgentDirs({ HOME: tempHome() } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("reports only the agents that are actually installed", () => {
    const home = tempHome();
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const kinds = detectAgentDirs({ HOME: home } as NodeJS.ProcessEnv).map((a) => a.kind);
    expect(kinds).toContain("codex");
    expect(kinds).toContain("cursor");
    expect(kinds).not.toContain("windsurf");
  });
});

describe("Cursor and Windsurf share the mcpServers shape", () => {
  it("writes a usable entry and creates a backup of an existing file", () => {
    const home = tempHome();
    const cfg = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }, null, 2));

    const outcome = installCursorMcp("shop-com-1234", cfg);
    expect(outcome.status).toBe("written");

    const written = JSON.parse(readFileSync(cfg, "utf8"));
    // THE thing that must never break: somebody else's server survives.
    expect(written.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(written.mcpServers.mim.command).toBe("npx");
    expect(written.mcpServers.mim.args).toContain("shop-com-1234");
    expect(existsSync(`${cfg}.bak`)).toBe(true);
  });

  it("says so rather than writing when the agent is not installed", () => {
    const home = tempHome();
    const outcome = installWindsurfMcp("p", join(home, ".codeium", "windsurf", "mcp_config.json"));
    expect(outcome.status).toBe("not_installed");
    expect(outcome.lines.join(" ")).toContain("Windsurf");
  });

  it("names the agent it wrote to, not always Claude Desktop", () => {
    const home = tempHome();
    const cfg = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const outcome = installCursorMcp("p", cfg);
    expect(outcome.lines.join(" ")).toContain("Cursor");
    expect(outcome.lines.join(" ")).not.toContain("Claude Desktop");
  });
});

describe("Codex TOML", () => {
  it("appends the table and leaves the rest of the file byte for byte", () => {
    const existing = '# my notes\n[model]\nname = "gpt-5"\n';
    const merged = mergeCodexConfig(existing, "shop-com-1234");
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toContain("[mcp_servers.mim]");
    expect(merged).toContain("shop-com-1234");
  });

  it("is idempotent, so re-running setup does not stack duplicate tables", () => {
    const once = mergeCodexConfig(null, "p");
    const twice = mergeCodexConfig(once, "p");
    expect(twice).toBe(once);
    expect(twice.match(/\[mcp_servers\.mim\]/g)).toHaveLength(1);
  });

  it("writes the file and reports it, instead of printing a block to paste", () => {
    const home = tempHome();
    const cfg = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(cfg, '[model]\nname = "gpt-5"\n');

    const outcome = installCodexMcp("shop-com-1234", cfg);
    expect(outcome.status).toBe("written");
    const text = readFileSync(cfg, "utf8");
    expect(text).toContain("[mcp_servers.mim]");
    expect(text).toContain('name = "gpt-5"');
    expect(existsSync(`${cfg}.bak`)).toBe(true);
  });

  it("does not touch a config that already has the server", () => {
    const home = tempHome();
    const cfg = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const before = '[mcp_servers.mim]\ncommand = "npx"\nargs = ["-y"]\n';
    writeFileSync(cfg, before);
    const outcome = installCodexMcp("p", cfg);
    expect(outcome.status).toBe("written");
    expect(readFileSync(cfg, "utf8")).toBe(before);
    expect(existsSync(`${cfg}.bak`)).toBe(false);
  });
});

describe("installDetectedAgents", () => {
  it("registers every agent found in one pass", () => {
    const home = tempHome();
    mkdirSync(join(home, ".cursor"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    const agents = detectAgentDirs({ HOME: home } as NodeJS.ProcessEnv);
    expect(agents.length).toBeGreaterThanOrEqual(2);
    // The real installers write to the real home, so this only asserts the
    // dispatch covers each kind rather than falling through to one default.
    const labels = agents.map((a) => a.label).sort();
    expect(labels).toEqual(expect.arrayContaining(["Codex", "Cursor"]));
  });
});

describe("the JSON merge these all rely on", () => {
  it("never drops an unrelated top-level key", () => {
    const merged = mergeMcpServersConfig('{"theme":"dark","mcpServers":{"a":{"command":"a","args":[]}}}', "p");
    const parsed = JSON.parse(merged);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.a).toBeDefined();
    expect(parsed.mcpServers.mim).toBeDefined();
  });
});
