import { readFileSync } from "node:fs";

import { parseFormat, printJson } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";
import { callMimMcpTool } from "./query";

export type QueryBqArgs = { describe: boolean; sql: string; limit: number | null };

export function parseQueryBqArgs(args: string[], readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): QueryBqArgs {
  let sql = "";
  let limit: number | null = null;
  let describe = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--sql") {
      // Not readValue: a query may legitimately start with "-" (a -- comment).
      const value = args[i + 1];
      if (value === undefined || !value.trim()) throw new Error("--sql requires a value");
      sql = value;
      i += 1;
    } else if (arg === "--sql-file") {
      const [value, next] = readValue(args, i, arg);
      sql = readFile(value);
      i = next;
    } else if (arg === "--limit") {
      const [value, next] = readValue(args, i, arg);
      limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
      i = next;
    } else if (arg === "--describe") {
      describe = true;
    } else {
      throw new Error(`unknown query-bq option: ${arg}`);
    }
  }
  if (describe && (sql || limit)) throw new Error("--describe does not take --sql/--sql-file/--limit");
  if (!sql.trim()) describe = true;
  return { describe, sql: sql.trim(), limit };
}

export function buildQueryBqToolCall(project: string, parsed: QueryBqArgs): { tool: string; args: Record<string, unknown> } {
  if (parsed.describe) return { tool: "describe_bq", args: { project } };
  const args: Record<string, unknown> = { project, sql: parsed.sql };
  if (parsed.limit) args.limit = parsed.limit;
  return { tool: "query_bq", args };
}

export async function runQueryBq(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "json");
  const parsed = parseQueryBqArgs(parsedFormat.args);
  const { tool, args: toolArgs } = buildQueryBqToolCall(resolvedProject, parsed);
  const payload = await runTrackedMimCommand(
    runtime,
    {
      command: parsed.describe ? "query-bq describe" : "query-bq",
      project: resolvedProject,
      metadata: { format: parsedFormat.format },
    },
    () => callMimMcpTool(runtime, tool, toolArgs),
  );
  printJson(payload);
}
