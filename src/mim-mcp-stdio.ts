#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  MIM_CLIENT_VERSION,
  defaultMimProject,
  loadMimConfig,
  mimApiBaseUrl,
  mimAuthToken,
  normalizeMimApiBaseUrl,
  trackMimUsageEvent,
} from "./mim-cli";

export type MimMcpOptions = {
  mcpUrl: string;
  apiBaseUrl: string;
  token: string;
  project: string;
  timeoutMs: number;
  traceId: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function mimMcpUsage(): string {
  return `mim-mcp

Proxies MCP stdio requests to TryMimetic growth context.

Usage:
  mim-mcp --project my-site
  mim-mcp --url https://trymimetic.com/api/mim/mcp --project my-site

Environment:
  MIM_API_TOKEN       Mimetic API token. Defaults to credentials from \`mim auth login\`.
  MIM_API_BASE_URL    TryMimetic API origin. Default: https://trymimetic.com.
  MIM_MCP_URL         Full MCP endpoint. Default: MIM_API_BASE_URL + /api/mim/mcp.
  MIM_PROJECT         Default project/site key.
  MIM_MCP_TIMEOUT_MS  Request timeout. Default: 30000.
`;
}

function readValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function normalizeMcpUrl(value: string, source: string, env: NodeJS.ProcessEnv): string {
  return normalizeMimApiBaseUrl(value, source, env);
}

export function parseMimMcpOptions(args = process.argv.slice(2), env = process.env): MimMcpOptions {
  const config = loadMimConfig(env);
  let apiBaseUrl = mimApiBaseUrl(config, env);
  let mcpUrl = env.MIM_MCP_URL?.trim() || "";
  let project = defaultMimProject(config, env);
  let token = mimAuthToken(config, env);
  let timeoutMs = Number(env.MIM_MCP_TIMEOUT_MS || "30000");

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url" || arg === "--mcp-url") {
      const [value, next] = readValue(args, i, arg);
      mcpUrl = value;
      i = next;
    } else if (arg === "--api-base-url") {
      const [value, next] = readValue(args, i, arg);
      apiBaseUrl = normalizeMimApiBaseUrl(value, arg, env);
      i = next;
    } else if (arg === "--project") {
      const [value, next] = readValue(args, i, arg);
      project = value;
      i = next;
    } else if (arg === "--timeout-ms") {
      const [value, next] = readValue(args, i, arg);
      timeoutMs = Number(value);
      i = next;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(mimMcpUsage());
      process.exit(0);
    } else {
      throw new Error(`unknown mim-mcp option: ${arg}`);
    }
  }

  if (!token) throw new Error("Mimetic auth is required; run `mim auth login` or set MIM_API_TOKEN");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive integer");

  return {
    apiBaseUrl,
    mcpUrl: mcpUrl ? normalizeMcpUrl(mcpUrl, "MIM_MCP_URL", env) : `${apiBaseUrl}/api/mim/mcp`,
    token,
    project,
    timeoutMs,
    traceId: randomUUID(),
  };
}

function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function requestId(payload: unknown): unknown {
  if (Array.isArray(payload)) return null;
  if (payload && typeof payload === "object" && "id" in payload) {
    return (payload as { id?: unknown }).id ?? null;
  }
  return null;
}

function toolName(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const request = payload as { method?: unknown; params?: unknown };
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object") return "";
  const name = (request.params as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function proxyMimMcpMessage(raw: string, options: MimMcpOptions, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const line = raw.trim();
  if (!line) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return jsonRpcError(null, -32700, "parse error");
  }

  const started = Date.now();
  const tool = toolName(payload);
  let status = "success";
  let httpStatus = 200;

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      options.mcpUrl,
      {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          "x-mim-client": "mim-mcp",
          "x-mim-client-version": MIM_CLIENT_VERSION,
          "x-mim-trace-id": options.traceId,
          ...(options.project ? { "x-mim-project": options.project } : {}),
        },
        body: JSON.stringify(payload),
      },
      options.timeoutMs,
    );

    httpStatus = response.status;
    const text = await response.text();
    if (!response.ok) {
      status = "error";
      const message = response.status === 401 || response.status === 403 ? "Mimetic MCP authentication failed" : `Mimetic MCP HTTP request failed with ${response.status}`;
      return jsonRpcError(requestId(payload), -32000, message);
    }
    if (!text.trim()) return null;
    return JSON.stringify(JSON.parse(text));
  } catch (error) {
    status = "error";
    const message = error instanceof Error && error.name === "AbortError" ? "Mimetic MCP request timed out" : "Mimetic MCP request failed";
    return jsonRpcError(requestId(payload), -32000, message);
  } finally {
    if (tool || (payload && typeof payload === "object" && !Array.isArray(payload))) {
      await trackMimUsageEvent(
        { apiBaseUrl: options.apiBaseUrl, token: options.token, traceId: options.traceId },
        {
          event: "mcp_request",
          client: "mim-mcp",
          project: options.project || undefined,
          tool: tool || undefined,
          status,
          duration_ms: Date.now() - started,
          metadata: {
            method: !Array.isArray(payload) && payload && typeof payload === "object" ? (payload as { method?: unknown }).method : "batch",
            http_status: httpStatus,
          },
        },
        fetchImpl,
      );
    }
  }
}

export function runMimMcpStdio(options = parseMimMcpOptions()): void {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let chain = Promise.resolve();

  const handleLine = (line: string) => {
    chain = chain
      .then(async () => {
        const response = await proxyMimMcpMessage(line, options);
        if (response) process.stdout.write(`${response}\n`);
      })
      .catch((error) => {
        process.stderr.write(`mim-mcp: ${error instanceof Error ? error.message : "request failed"}\n`);
      });
  };

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf("\n");
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) handleLine(buffer);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runMimMcpStdio();
  } catch (error) {
    process.stderr.write(`mim-mcp: ${error instanceof Error ? error.message : "startup failed"}\n`);
    process.exit(1);
  }
}
