import { asRecord, formatAnalyticsSetupPayload, parseFormat, printJson, sleep } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";
import { callMimMcpTool } from "./query";

export function parseSetupAnalyticsArgs(args: string[]): { status: boolean; wait: boolean; channel: string } {
  let status = false;
  let wait = false;
  let channel = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--status") status = true;
    else if (arg === "--wait") wait = true;
    else if (arg === "--channel") {
      const [value, next] = readValue(args, i, arg);
      if (value !== "auto" && value !== "agent") throw new Error("--channel must be auto or agent");
      channel = value;
      i = next;
    } else throw new Error(`unknown setup-analytics option: ${arg}`);
  }
  if (status && wait) throw new Error("--status and --wait cannot be combined");
  if (status && channel) throw new Error("--channel only applies when starting a setup");
  return { status, wait, channel };
}

// States where polling should stop: the run finished (done = installed, live =
// events flowing) or cannot proceed without a human (failed / already_connected).
const SETUP_ANALYTICS_TERMINAL_STATES = new Set(["done", "live", "failed", "already_connected"]);

export async function runSetupAnalytics(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "markdown");
  const { status, wait, channel } = parseSetupAnalyticsArgs(parsedFormat.args);

  const payload = await runTrackedMimCommand(
    runtime,
    { command: status ? "setup-analytics status" : "setup-analytics", project: resolvedProject, metadata: { wait, channel: channel || "auto", format: parsedFormat.format } },
    async () => {
      if (status) return callMimMcpTool(runtime, "analytics_setup_status", { project: resolvedProject });
      const startArgs: Record<string, unknown> = { project: resolvedProject };
      if (channel) startArgs.channel = channel;
      let current = await callMimMcpTool(runtime, "setup_analytics", startArgs);
      if (!wait) return current;
      const deadline = Date.now() + 10 * 60 * 1000;
      let state = String(asRecord(current).status || "");
      while (!SETUP_ANALYTICS_TERMINAL_STATES.has(state) && Date.now() < deadline) {
        await sleep(10_000);
        current = await callMimMcpTool(runtime, "analytics_setup_status", { project: resolvedProject });
        state = String(asRecord(current).status || "");
        if (parsedFormat.format !== "json") process.stderr.write(`analytics setup: ${state || "unknown"}\n`);
      }
      return current;
    },
  );

  if (parsedFormat.format === "json") printJson(payload);
  else console.log(formatAnalyticsSetupPayload(payload));
}
