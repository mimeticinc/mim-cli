import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildQueryBqToolCall, mimMain, mimUsage, parseQueryBqArgs } from "../src/mim-cli";

const SQL = "SELECT event_name, COUNT(*) AS n FROM `events_*` WHERE _TABLE_SUFFIX >= '20260901' GROUP BY 1";

describe("mim query-bq argument parsing", () => {
  it("defaults to describe when no SQL is given", () => {
    expect(parseQueryBqArgs([])).toEqual({ describe: true, sql: "", limit: null });
    expect(parseQueryBqArgs(["--describe"])).toEqual({ describe: true, sql: "", limit: null });
  });

  it("parses --sql and --limit", () => {
    expect(parseQueryBqArgs(["--sql", SQL, "--limit", "25"])).toEqual({ describe: false, sql: SQL, limit: 25 });
  });

  it("accepts SQL that starts with a comment", () => {
    const sql = "-- top events\nSELECT 1";
    expect(parseQueryBqArgs(["--sql", sql]).sql).toBe(sql);
  });

  it("reads --sql-file", () => {
    const parsed = parseQueryBqArgs(["--sql-file", "q.sql"], (path) => (path === "q.sql" ? `  ${SQL}\n` : ""));
    expect(parsed).toEqual({ describe: false, sql: SQL, limit: null });
  });

  it("rejects bad input", () => {
    expect(() => parseQueryBqArgs(["--sql"])).toThrow("--sql requires a value");
    expect(() => parseQueryBqArgs(["--sql", "  "])).toThrow("--sql requires a value");
    expect(() => parseQueryBqArgs(["--sql", SQL, "--limit", "0"])).toThrow("positive integer");
    expect(() => parseQueryBqArgs(["--describe", "--sql", SQL])).toThrow("--describe does not take");
    expect(() => parseQueryBqArgs(["--bogus"])).toThrow("unknown query-bq option");
  });

  it("maps to the describe_bq and query_bq MCP tools", () => {
    expect(buildQueryBqToolCall("talkingpets.ai", parseQueryBqArgs([]))).toEqual({
      tool: "describe_bq",
      args: { project: "talkingpets.ai" },
    });
    expect(buildQueryBqToolCall("talkingpets.ai", parseQueryBqArgs(["--sql", SQL, "--limit", "10"]))).toEqual({
      tool: "query_bq",
      args: { project: "talkingpets.ai", sql: SQL, limit: 10 },
    });
    expect(buildQueryBqToolCall("x", parseQueryBqArgs(["--sql", SQL])).args).not.toHaveProperty("limit");
  });

  it("is documented in usage", () => {
    const usage = mimUsage();
    expect(usage).toContain("query-bq --sql");
    expect(usage).toContain("query-bq --describe");
  });
});

describe("mim query-bq end to end", () => {
  let configDir: string;
  const saved: Record<string, string | undefined> = {};
  const envKeys = ["MIM_CONFIG_DIR", "MIM_API_TOKEN", "MIM_TELEMETRY", "MIM_PROJECT", "MIM_API_BASE_URL"];

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "mim-bq-test-"));
    for (const key of envKeys) saved[key] = process.env[key];
    process.env.MIM_CONFIG_DIR = configDir;
    process.env.MIM_API_TOKEN = "test-token";
    process.env.MIM_TELEMETRY = "0";
    delete process.env.MIM_PROJECT;
    delete process.env.MIM_API_BASE_URL;
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(configDir, { recursive: true, force: true });
  });

  function stubMcp(result: unknown, isError = false) {
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify(result) }], isError },
      }), { status: 200 });
    }));
    return bodies;
  }

  it("sends query_bq and prints columns and rows", async () => {
    const payload = { dataset: "p.analytics_1", columns: [{ name: "n", type: "INTEGER", mode: "NULLABLE" }], rows: [{ n: 7 }] };
    const bodies = stubMcp(payload);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await mimMain(["query-bq", "--project", "talkingpets.ai", "--sql", SQL, "--limit", "5"]);
    const call = bodies.find((b) => b.method === "tools/call");
    expect(call?.params).toEqual({ name: "query_bq", arguments: { project: "talkingpets.ai", sql: SQL, limit: 5 } });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(payload);
  });

  it("surfaces server-side scope refusals as errors", async () => {
    stubMcp({ error: "query references p.crux.x, outside this project's dataset p.analytics_1" }, true);
    await expect(mimMain(["query-bq", "--project", "talkingpets.ai", "--sql", "SELECT * FROM crux.x"]))
      .rejects.toThrow("outside this project's dataset");
  });

  it("describes by default", async () => {
    const bodies = stubMcp({ dataset: "analytics_1", tables: {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await mimMain(["query-bq", "--project", "talkingpets.ai"]);
    expect(bodies.find((b) => b.method === "tools/call")?.params).toEqual({
      name: "describe_bq",
      arguments: { project: "talkingpets.ai" },
    });
  });
});
