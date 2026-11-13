import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  claudeDesktopConnectorSteps,
  headlessMcpInstructions,
  installVscodeMcp,
  installWindsurfMcp,
  mergeCodexConfig,
} from "../src/commands/mcp-config";
import { MIM_MCP_DEPRECATION } from "../src/mim-mcp-stdio";

const URL = "https://mcp.trymimetic.com/mcp?toolsets=diagnose,data";
const tempHome = () => mkdtempSync(join(tmpdir(), "mim-hosted-"));

describe("hosted setup for every client (the Stripe pattern)", () => {
  it("VS Code gets a typed http entry and keeps other servers", () => {
    const home = tempHome();
    const cfg = join(home, "Code", "User", "mcp.json");
    mkdirSync(join(home, "Code", "User"), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ servers: { other: { type: "stdio", command: "x" } } }));
    const outcome = installVscodeMcp("shop", cfg);
    expect(outcome.status).toBe("written");
    const written = JSON.parse(readFileSync(cfg, "utf8"));
    expect(written.servers.other).toEqual({ type: "stdio", command: "x" });
    expect(written.servers.mim).toEqual({ type: "http", url: URL, headers: { "x-mim-project": "shop" } });
  });

  it("Windsurf uses serverUrl, and --local still writes the relay", () => {
    const home = tempHome();
    const cfg = join(home, "windsurf", "mcp_config.json");
    mkdirSync(join(home, "windsurf"), { recursive: true });
    installWindsurfMcp("shop", cfg);
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers.mim.serverUrl).toBe(URL);
    installWindsurfMcp("shop", cfg, { local: true });
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers.mim.command).toBe("npx");
  });

  it("Codex appends a url table without touching the rest of the file", () => {
    const existing = '# notes\n[model]\nname = "gpt-5"\n';
    const merged = mergeCodexConfig(existing, undefined);
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toContain(`url = "${URL}"`);
    expect(merged).not.toContain("npx");
  });

  it("Claude Desktop gets connector steps instead of a relay entry", () => {
    expect(claudeDesktopConnectorSteps().join(" ")).toContain(URL);
  });

  it("headless config reads the key from the environment, never inline", () => {
    const text = headlessMcpInstructions("shop").join("\n");
    expect(text).toContain("export MIM_API_TOKEN=$(mim auth token)");
    expect(text).toContain("Bearer ${MIM_API_TOKEN}");
    expect(text).toContain(URL);
  });

  it("the relay announces it is deprecated and where to go", () => {
    expect(MIM_MCP_DEPRECATION).toContain("deprecated");
    expect(MIM_MCP_DEPRECATION).toContain(URL);
  });
});
