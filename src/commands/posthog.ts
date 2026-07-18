import { asRecord, parseFormat, printJson } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { openBrowser, readValue } from "../util";
import { callMimMcpTool } from "./query";

export function parsePostHogArgs(args: string[]): { subcommand: string; hogql: string; posthogProject: string; limit: number | null; noOpen: boolean } {
  const [subcommand = "query", ...rest] = args;
  if (!["connect", "query"].includes(subcommand)) {
    throw new Error(`unknown posthog command: ${subcommand} (use connect or query)`);
  }
  let hogql = "";
  let posthogProject = "";
  let limit: number | null = null;
  let noOpen = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--hogql") {
      const [value, next] = readValue(rest, i, arg);
      hogql = value;
      i = next;
    } else if (arg === "--posthog-project") {
      const [value, next] = readValue(rest, i, arg);
      posthogProject = value;
      i = next;
    } else if (arg === "--limit") {
      const [value, next] = readValue(rest, i, arg);
      limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
      i = next;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else {
      throw new Error(`unknown posthog ${subcommand} option: ${arg}`);
    }
  }
  if ((hogql || posthogProject || limit) && subcommand !== "query") {
    throw new Error("--hogql/--posthog-project/--limit only apply to posthog query");
  }
  if (noOpen && subcommand !== "connect") throw new Error("--no-open only applies to posthog connect");
  return { subcommand, hogql, posthogProject, limit, noOpen };
}

export async function runPostHog(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "json");
  const { subcommand, hogql, posthogProject, limit, noOpen } = parsePostHogArgs(parsedFormat.args);

  if (subcommand === "connect") {
    const payload = await runTrackedMimCommand(
      runtime,
      { command: "posthog connect", project: resolvedProject, metadata: { format: parsedFormat.format } },
      () => callMimMcpTool(runtime, "connect_posthog", { project: resolvedProject }),
    );
    const root = asRecord(payload);
    const url = String(root.authorization_url || "");
    if (!url) throw new Error("no authorization URL was returned");
    if (parsedFormat.format === "json") printJson(payload);
    else {
      console.log("Open this URL to approve read-only PostHog access:");
      console.log(`  ${url}`);
      if (root.message) console.log(String(root.message));
    }
    if (!noOpen) openBrowser(url);
    return;
  }

  const toolArgs: Record<string, unknown> = { project: resolvedProject };
  if (hogql) toolArgs.hogql = hogql;
  if (posthogProject) toolArgs.posthog_project_id = posthogProject;
  if (limit) toolArgs.limit = limit;
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "posthog query", project: resolvedProject, metadata: { format: parsedFormat.format } },
    () => callMimMcpTool(runtime, "query_posthog", toolArgs),
  );
  printJson(payload);
}
