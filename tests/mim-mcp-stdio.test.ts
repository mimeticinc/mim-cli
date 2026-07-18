import { describe, expect, it } from "vitest";

import { parseMimMcpOptions, proxyMimMcpMessage } from "../src/mim-mcp-stdio";

describe("mim MCP stdio wrapper", () => {
  it("requires Mimetic auth and derives the hosted MCP URL", () => {
    expect(() => parseMimMcpOptions([], { MIM_CONFIG_DIR: "/tmp/missing-mim-config" })).toThrow("Mimetic auth is required");

    const options = parseMimMcpOptions([], {
      MIM_API_TOKEN: "mim_token",
      MIM_API_BASE_URL: "https://trymimetic.com/",
      MIM_PROJECT: "dubbah",
    });

    expect(options.mcpUrl).toBe("https://trymimetic.com/api/mim/mcp");
    expect(options.apiBaseUrl).toBe("https://trymimetic.com");
    expect(options.token).toBe("mim_token");
    expect(options.project).toBe("dubbah");
  });

  it("accepts explicit URL, project, and timeout flags while reading the token from the environment", () => {
    const options = parseMimMcpOptions(
      [
        "--url",
        "https://api.trymimetic.com/api/mim/mcp",
        "--project",
        "normal",
        "--timeout-ms",
        "1500",
      ],
      { MIM_API_TOKEN: "env_token" },
    );

    expect(options.mcpUrl).toBe("https://api.trymimetic.com/api/mim/mcp");
    expect(options.token).toBe("env_token");
    expect(options.project).toBe("normal");
    expect(options.timeoutMs).toBe(1500);
  });

  it("rejects tokens on the command line and insecure remote MCP URLs", () => {
    expect(() => parseMimMcpOptions(["--token", "process-visible-secret"], {
      MIM_API_TOKEN: "env_token",
    })).toThrow("unknown mim-mcp option: --token");
    expect(() => parseMimMcpOptions(["--url", "http://api.example.com/mcp"], {
      MIM_API_TOKEN: "env_token",
    })).toThrow("must use https");
    expect(parseMimMcpOptions(["--url", "http://127.0.0.1:8787/mcp"], {
      MIM_API_TOKEN: "env_token",
    }).mcpUrl).toBe("http://127.0.0.1:8787/mcp");
  });

  it("proxies MCP requests with project and trace headers without putting tokens in the body", async () => {
    const calls: Array<{ url: string | URL; init?: RequestInit }> = [];
    const response = { jsonrpc: "2.0", id: 1, result: { content: [] } };
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    };

    const output = await proxyMimMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_growth_overview", arguments: {} } }),
      {
        mcpUrl: "https://trymimetic.com/api/mim/mcp",
        apiBaseUrl: "https://trymimetic.com",
        token: "mim_token",
        project: "dubbah",
        timeoutMs: 30000,
        traceId: "trace-1",
      },
      fetchImpl,
    );

    expect(output).toBe(JSON.stringify(response));
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://trymimetic.com/api/mim/mcp");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer mim_token",
      "x-mim-project": "dubbah",
      "x-mim-trace-id": "trace-1",
    });
    expect(calls[0].init?.redirect).toBe("error");
    expect(String(calls[0].init?.body)).not.toContain("mim_token");
    expect(calls[1].url).toBe("https://trymimetic.com/api/mim/usage-events");
    expect(String(calls[1].init?.body)).toContain("get_growth_overview");
    expect(String(calls[1].init?.body)).not.toContain("mim_token");
  });

  it("returns JSON-RPC errors for parse and auth failures", async () => {
    const parseError = await proxyMimMcpMessage("{bad", {
      mcpUrl: "https://trymimetic.com/api/mim/mcp",
      apiBaseUrl: "https://trymimetic.com",
      token: "mim_token",
      project: "",
      timeoutMs: 30000,
      traceId: "trace-1",
    });
    const authError = await proxyMimMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: "abc", method: "tools/list" }),
      {
        mcpUrl: "https://trymimetic.com/api/mim/mcp",
        apiBaseUrl: "https://trymimetic.com",
        token: "bad",
        project: "",
        timeoutMs: 30000,
        traceId: "trace-1",
      },
      async () => new Response("unauthorized", { status: 401 }),
    );

    expect(JSON.parse(parseError || "{}")).toMatchObject({ id: null, error: { code: -32700 } });
    expect(JSON.parse(authError || "{}")).toMatchObject({ id: "abc", error: { code: -32000, message: "Mimetic MCP authentication failed" } });
  });
});
