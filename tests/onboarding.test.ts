import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMimConfig, saveMimConfig } from "../src/config";
import {
  ExecFn,
  ExecResult,
  claudeDesktopConfigPath,
  installClaudeDesktopMcp,
  mergeMcpServersConfig,
  mimMcpServerEntry,
  probeMimMcpEndpoint,
  registerClaudeCodeMcp,
} from "../src/commands/mcp-config";
import { findOnPath, pathFixLines, runSetup } from "../src/commands/setup";

function fakeExec(handler: (command: string, args: string[]) => Partial<ExecResult> | undefined): ExecFn {
  return async (command, args) => {
    const result = handler(command, args) || {};
    return { code: 0, stdout: "", stderr: "", ...result };
  };
}

describe("Claude desktop config merge", () => {
  it("preserves existing servers and unrelated keys", () => {
    const existing = JSON.stringify({
      globalShortcut: "Cmd+Shift+Space",
      mcpServers: { other: { command: "other-server", args: [] } },
    });
    const merged = JSON.parse(mergeMcpServersConfig(existing, "acme-shop"));
    expect(merged.globalShortcut).toBe("Cmd+Shift+Space");
    expect(merged.mcpServers.other.command).toBe("other-server");
    expect(merged.mcpServers.mim).toEqual(mimMcpServerEntry("acme-shop"));
  });

  it("creates a fresh config when none exists", () => {
    const merged = JSON.parse(mergeMcpServersConfig(null));
    expect(merged.mcpServers.mim.command).toBe("npx");
    expect(merged.mcpServers.mim.args).toContain("mim-mcp");
  });

  it("refuses to overwrite a config whose root is not an object", () => {
    expect(() => mergeMcpServersConfig("[]")).toThrow("not a JSON object");
  });

  it("resolves the per-platform Claude Desktop config path", () => {
    expect(claudeDesktopConfigPath("darwin", { HOME: "/Users/x" })).toBe(
      "/Users/x/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(claudeDesktopConfigPath("linux", { HOME: "/home/x" })).toBe(
      "/home/x/.config/Claude/claude_desktop_config.json",
    );
  });

  it("writes, backs up, and verifies the desktop config on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "mim-desktop-test-"));
    try {
      const dir = join(root, "Claude");
      mkdirSync(dir);
      const configPath = join(dir, "claude_desktop_config.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: { keepme: { command: "x" } } }));

      const outcome = installClaudeDesktopMcp("acme-shop", configPath);

      expect(outcome.status).toBe("written");
      const written = JSON.parse(readFileSync(configPath, "utf8"));
      expect(written.mcpServers.keepme.command).toBe("x");
      expect(written.mcpServers.mim.args).toContain("mim-mcp");
      expect(existsSync(`${configPath}.bak`)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports Claude Desktop as not installed instead of creating stray directories", () => {
    const outcome = installClaudeDesktopMcp("acme-shop", join(tmpdir(), "mim-nonexistent", "Claude", "config.json"));
    expect(outcome.status).toBe("not_installed");
  });
});

describe("Claude Code MCP registration", () => {
  it("reports a missing claude CLI as its own outcome", async () => {
    const exec = fakeExec(() => ({ code: 127, stderr: "command not found" }));
    const outcome = await registerClaudeCodeMcp("", exec);
    expect(outcome.status).toBe("cli_missing");
  });

  it("leaves an existing registration in place", async () => {
    const calls: string[][] = [];
    const exec = fakeExec((_, args) => {
      calls.push(args);
      return { code: 0, stdout: "mim: npx ..." };
    });
    const outcome = await registerClaudeCodeMcp("", exec);
    expect(outcome.status).toBe("already");
    expect(calls.some((args) => args.includes("add"))).toBe(false);
  });

  it("registers at user scope and verifies through claude mcp get", async () => {
    const calls: string[][] = [];
    let getCalls = 0;
    const exec = fakeExec((_, args) => {
      calls.push(args);
      if (args[1] === "get") {
        getCalls += 1;
        return { code: getCalls === 1 ? 1 : 0, stdout: getCalls === 1 ? "" : "mim: npx" };
      }
      return { code: 0 };
    });
    const outcome = await registerClaudeCodeMcp("acme-shop", exec);
    expect(outcome.status).toBe("registered");
    const addCall = calls.find((args) => args[1] === "add");
    expect(addCall).toContain("--scope");
    expect(addCall).toContain("user");
    expect(getCalls).toBe(2);
  });

  it("does not report success when the add exits 0 but the server does not read back", async () => {
    const exec = fakeExec((_, args) => (args[1] === "get" ? { code: 1 } : { code: 0 }));
    const outcome = await registerClaudeCodeMcp("", exec);
    expect(outcome.status).toBe("failed");
    expect(outcome.lines.join(" ")).toContain("claude mcp get mim");
  });

  it("surfaces the real claude mcp add error with the manual command", async () => {
    const exec = fakeExec((_, args) => {
      if (args[1] === "get") return { code: 1 };
      return { code: 2, stderr: "boom" };
    });
    const outcome = await registerClaudeCodeMcp("", exec);
    expect(outcome.status).toBe("failed");
    expect(outcome.lines.join(" ")).toContain("boom");
  });
});

describe("MCP endpoint probe", () => {
  const runtime = { apiBaseUrl: "https://trymimetic.com", token: "mim_token", traceId: "trace" };

  it("passes only when the endpoint returns tools", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ jsonrpc: "2.0", id: "x", result: { tools: [{ name: "list_projects" }] } }),
      { status: 200 },
    ));
    const probe = await probeMimMcpEndpoint(runtime, fetchMock as unknown as typeof fetch);
    expect(probe.ok).toBe(true);
    expect(probe.toolCount).toBe(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.method).toBe("tools/list");
  });

  it("fails with the HTTP status when auth is rejected", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const probe = await probeMimMcpEndpoint(runtime, fetchMock as unknown as typeof fetch);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("401");
  });
});

describe("PATH diagnosis", () => {
  it("finds executables on PATH and reports absence", () => {
    const root = mkdtempSync(join(tmpdir(), "mim-path-test-"));
    try {
      const tool = join(root, "mim");
      writeFileSync(tool, "#!/bin/sh\n");
      chmodSync(tool, 0o755);
      expect(findOnPath("mim", { PATH: `/nonexistent:${root}` }, "darwin")).toBe(tool);
      expect(findOnPath("mim", { PATH: "/nonexistent" }, "darwin")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the right shell profile and the exact export line", () => {
    const lines = pathFixLines("/bin/zsh", "/opt/npm/bin").join("\n");
    expect(lines).toContain("~/.zshrc");
    expect(lines).toContain('export PATH="/opt/npm/bin:$PATH"');
    expect(lines).toContain("npx -y @mimeticinc/mim-cli");
  });
});

describe.sequential("mim setup end to end", () => {
  let root = "";
  let logLines: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mim-setup-test-"));
    vi.stubEnv("MIM_CONFIG_DIR", root);
    vi.stubEnv("MIM_API_BASE_URL", "https://trymimetic.com");
    vi.stubEnv("MIM_API_TOKEN", "");
    vi.stubEnv("MIM_TELEMETRY", "0");
    logLines = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      logLines.push(String(line ?? ""));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("reuses the login, registers MCP, verifies the endpoint, and mints no new token", async () => {
    saveMimConfig({ accessToken: "mim_existing_token", user: { email: "hunter.monk@gmail.com" } });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/projects")) {
        return new Response(JSON.stringify({ projects: [{ key: "laso-finance-ca99a2382b" }] }), { status: 200 });
      }
      if (url.endsWith("/api/mim/mcp")) {
        return new Response(JSON.stringify({ result: { tools: [{ name: "list_projects" }, { name: "query_ga4" }] } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    let getCalls = 0;
    const exec = fakeExec((command, args) => {
      if (command === "npm") return { code: 0, stdout: "/opt/npm\n" };
      if (args[1] === "get") {
        getCalls += 1;
        return { code: getCalls === 1 ? 1 : 0, stdout: getCalls === 1 ? "" : "mim" };
      }
      return { code: 0 };
    });

    await runSetup([], exec);

    const output = logLines.join("\n");
    expect(output).toContain("signed in as hunter.monk@gmail.com");
    expect(output).toContain("existing login reused");
    expect(output).toContain("laso-finance-ca99a2382b");
    expect(output).toContain("2 tools");
    expect(output).toContain("Done.");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/cli/device"))).toBe(false);
    expect(loadMimConfig().defaultProject).toBe("laso-finance-ca99a2382b");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("fails loudly with a next action when the MCP endpoint rejects the token", async () => {
    saveMimConfig({ accessToken: "mim_existing_token", user: { email: "owner@example.com" } });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/projects")) {
        return new Response(JSON.stringify({ projects: [{ key: "acme-shop" }] }), { status: 200 });
      }
      return new Response("unauthorized", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const exec = fakeExec((command, args) => {
      if (command === "npm") return { code: 0, stdout: "/opt/npm\n" };
      if (args[1] === "get") return { code: 0, stdout: "mim" };
      return { code: 0 };
    });

    await runSetup([], exec);

    const output = logLines.join("\n");
    expect(output).toContain("Setup is not finished");
    expect(output).toContain("mim auth status");
    expect(process.exitCode).toBe(1);
  });
});
