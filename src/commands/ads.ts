import { formatAdsStatusPayload, formatAnalyticsSetupPayload, parseFormat, printJson } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";
import { callMimMcpTool } from "./query";

export function parseAdsArgs(args: string[]): { subcommand: string; gaql: string; limit: number | null } {
  const [subcommand = "status", ...rest] = args;
  if (!["status", "query", "setup"].includes(subcommand)) {
    throw new Error(`unknown ads command: ${subcommand} (use status, query, or setup)`);
  }
  let gaql = "";
  let limit: number | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--gaql") {
      const [value, next] = readValue(rest, i, arg);
      gaql = value;
      i = next;
    } else if (arg === "--limit") {
      const [value, next] = readValue(rest, i, arg);
      limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
      i = next;
    } else {
      throw new Error(`unknown ads ${subcommand} option: ${arg}`);
    }
  }
  if (gaql && subcommand !== "query") throw new Error("--gaql only applies to ads query");
  return { subcommand, gaql, limit };
}

export async function runAds(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "markdown");
  const { subcommand, gaql, limit } = parseAdsArgs(parsedFormat.args);

  const tool = subcommand === "query" ? "query_google_ads"
    : subcommand === "setup" ? "setup_google_ads"
    : "google_ads_status";
  const toolArgs: Record<string, unknown> = { project: resolvedProject };
  if (gaql) toolArgs.gaql = gaql;
  if (limit) toolArgs.limit = limit;

  const payload = await runTrackedMimCommand(
    runtime,
    { command: `ads ${subcommand}`, project: resolvedProject, metadata: { format: parsedFormat.format } },
    () => callMimMcpTool(runtime, tool, toolArgs),
  );

  if (parsedFormat.format === "json" || subcommand === "query") printJson(payload);
  else if (subcommand === "status") console.log(formatAdsStatusPayload(payload));
  else console.log(formatAnalyticsSetupPayload(payload));
}
