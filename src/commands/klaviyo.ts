import { asRecord, parseFormat, printJson } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { openBrowser, readValue } from "../util";
import { callMimMcpTool } from "./query";

const KLAVIYO_RESOURCES = new Set(["campaigns", "flows", "lists", "segments", "metrics",
  "campaign_performance", "flow_performance", "abandoned_cart_status", "dead_links"]);

export function parseKlaviyoArgs(args: string[]): { subcommand: string; resource: string; filter: string; timeframe: string; noOpen: boolean } {
  const [subcommand = "query", ...rest] = args;
  if (!["connect", "query"].includes(subcommand)) {
    throw new Error(`unknown klaviyo command: ${subcommand} (use connect or query)`);
  }
  let resource = "";
  let filter = "";
  let timeframe = "";
  let noOpen = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--resource") {
      const [value, next] = readValue(rest, i, arg);
      if (!KLAVIYO_RESOURCES.has(value)) throw new Error(`--resource must be one of ${[...KLAVIYO_RESOURCES].join(", ")}`);
      resource = value;
      i = next;
    } else if (arg === "--filter") {
      const [value, next] = readValue(rest, i, arg);
      filter = value;
      i = next;
    } else if (arg === "--timeframe") {
      const [value, next] = readValue(rest, i, arg);
      timeframe = value;
      i = next;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else {
      throw new Error(`unknown klaviyo ${subcommand} option: ${arg}`);
    }
  }
  if ((resource || filter || timeframe) && subcommand !== "query") throw new Error("--resource/--filter/--timeframe only apply to klaviyo query");
  if (noOpen && subcommand !== "connect") throw new Error("--no-open only applies to klaviyo connect");
  return { subcommand, resource, filter, timeframe, noOpen };
}

export async function runKlaviyo(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "json");
  const { subcommand, resource, filter, timeframe, noOpen } = parseKlaviyoArgs(parsedFormat.args);

  if (subcommand === "connect") {
    const payload = await runTrackedMimCommand(
      runtime,
      { command: "klaviyo connect", project: resolvedProject, metadata: { format: parsedFormat.format } },
      () => callMimMcpTool(runtime, "connect_klaviyo", { project: resolvedProject }),
    );
    const root = asRecord(payload);
    const url = String(root.authorization_url || "");
    if (!url) throw new Error("no authorization URL was returned");
    if (parsedFormat.format === "json") printJson(payload);
    else {
      console.log("Open this URL to approve read-only Klaviyo access:");
      console.log(`  ${url}`);
      if (root.message) console.log(String(root.message));
    }
    if (!noOpen) openBrowser(url);
    return;
  }

  const toolArgs: Record<string, unknown> = { project: resolvedProject };
  if (resource) toolArgs.resource = resource;
  if (filter) toolArgs.filter = filter;
  if (timeframe) toolArgs.timeframe = timeframe;
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "klaviyo query", project: resolvedProject, metadata: { resource: resource || "campaigns", format: parsedFormat.format } },
    () => callMimMcpTool(runtime, "query_klaviyo", toolArgs),
  );
  printJson(payload);
}
