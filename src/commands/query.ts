import { parseFormat, printJson } from "../format";
import { MimRuntime, mimRequest, requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";

export function buildQueryToolArgs(
  tool: "query_ga4" | "query_gsc",
  project: string,
  rest: string[],
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = { project };
  let metrics: string[] = [];
  let dimensions: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--metrics") {
      const [value, next] = readValue(rest, i, arg);
      metrics = value.split(",").map((s) => s.trim()).filter(Boolean);
      i = next;
    } else if (arg === "--dimensions" || arg === "--dims") {
      const [value, next] = readValue(rest, i, arg);
      dimensions = value.split(",").map((s) => s.trim()).filter(Boolean);
      i = next;
    } else if (arg === "--start-date" || arg === "--start") {
      const [value, next] = readValue(rest, i, arg);
      toolArgs.start_date = value;
      i = next;
    } else if (arg === "--end-date" || arg === "--end") {
      const [value, next] = readValue(rest, i, arg);
      toolArgs.end_date = value;
      i = next;
    } else if (arg === "--limit") {
      const [value, next] = readValue(rest, i, arg);
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--limit must be a positive integer");
      if (tool === "query_gsc") toolArgs.row_limit = n;
      else toolArgs.limit = n;
      i = next;
    } else if (arg === "--order-by") {
      const [value, next] = readValue(rest, i, arg);
      toolArgs.order_by_metric = value;
      i = next;
    } else {
      throw new Error(`unknown ${tool} option: ${arg}`);
    }
  }

  if (metrics.length) toolArgs.metrics = metrics;
  if (dimensions.length) toolArgs.dimensions = dimensions;
  if (tool === "query_ga4" && !metrics.length) {
    throw new Error("query-ga4 requires --metrics (e.g. --metrics sessions,conversions)");
  }
  return toolArgs;
}

export async function callMimMcpTool(runtime: MimRuntime, tool: string, toolArgs: Record<string, unknown>): Promise<unknown> {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: toolArgs } };
  const response = await mimRequest<{ result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } }>(
    runtime,
    "/api/mim/mcp",
    { body },
  );

  if (response?.error) throw new Error(response.error.message || "request failed");
  const result = response?.result;
  const text = result?.content?.[0]?.text ?? "";
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  if (result?.isError) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error)
        : String(parsed);
    throw new Error(message || `${tool} failed`);
  }
  return parsed;
}

export async function runQuery(tool: "query_ga4" | "query_gsc", args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "json");
  const toolArgs = buildQueryToolArgs(tool, resolvedProject, parsedFormat.args);

  const parsed = await runTrackedMimCommand(
    runtime,
    {
      command: tool,
      project: resolvedProject,
      metadata: {
        metrics: Array.isArray(toolArgs.metrics) ? toolArgs.metrics.length : 0,
        dimensions: Array.isArray(toolArgs.dimensions) ? toolArgs.dimensions.length : 0,
      },
    },
    () => callMimMcpTool(runtime, tool, toolArgs),
  );
  printJson(parsed);
}
