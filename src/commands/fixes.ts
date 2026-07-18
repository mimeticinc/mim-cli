import { FixItem, FixesResponse, fixUrl, fixesFromPayload, formatFixStartPayload, formatFixesPayload, parseFormat, parseLimit, printJson } from "../format";
import { MimRuntime, mimRequest, projectPath, requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { openBrowser, readValue } from "../util";

function resolveFixItem(payload: FixesResponse, identifier: string): FixItem {
  const fixes = fixesFromPayload(payload);
  const trimmed = identifier.trim();
  const numeric = Number(trimmed);
  let item: FixItem | undefined;
  if (Number.isInteger(numeric)) {
    item =
      fixes.find((candidate) => candidate.rank === numeric) ||
      fixes.find((candidate) => candidate.finding_index === numeric - 1) ||
      fixes.find((candidate) => candidate.finding_index === numeric);
  }
  item ||= fixes.find((candidate) => candidate.id === trimmed);
  if (!item) throw new Error(`fix ${identifier} was not found; run \`mim fixes list\``);
  return item;
}

function parseFixTarget(args: string[]): { target: string; args: string[] } {
  let target = "";
  const kept: string[] = [];
  const valid = new Set(["review", "preview", "pr", "diff", "workflow", "report"]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      const [value, next] = readValue(args, i, arg);
      if (!valid.has(value)) throw new Error("--target must be review, preview, pr, diff, workflow, or report");
      target = value;
      i = next;
    } else if (arg === "--review" || arg === "--preview" || arg === "--pr" || arg === "--diff" || arg === "--workflow" || arg === "--report") {
      target = arg.slice(2);
    } else {
      kept.push(arg);
    }
  }
  return { target, args: kept };
}

async function fetchFixes(runtime: MimRuntime, project: string, limit: number): Promise<FixesResponse> {
  const path = projectPath(`/api/mim/projects/:project/fixes?limit=${limit}`, project);
  return mimRequest<FixesResponse>(runtime, path);
}

export async function runFixes(args: string[]): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  const { runtime, args: kept, project } = runtimeFromArgs(rest);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);

  if (subcommand === "list" || subcommand === "status") {
    const parsedFormat = parseFormat(kept, "markdown");
    const parsedLimit = parseLimit(parsedFormat.args, 20);
    if (parsedLimit.args.length) throw new Error(`unknown fixes ${subcommand} option: ${parsedLimit.args[0]}`);
    const payload = await runTrackedMimCommand(
      runtime,
      { command: `fixes ${subcommand}`, project: resolvedProject, metadata: { format: parsedFormat.format, limit: parsedLimit.limit } },
      () => fetchFixes(runtime, resolvedProject, parsedLimit.limit),
    );
    if (parsedFormat.format === "json") printJson(payload);
    else console.log(formatFixesPayload(payload));
    return;
  }

  if (subcommand === "start") {
    const parsedFormat = parseFormat(kept, "markdown");
    const [identifier, ...unknown] = parsedFormat.args;
    if (!identifier) throw new Error("fixes start requires a rank or finding id");
    if (unknown.length) throw new Error(`unknown fixes start option: ${unknown[0]}`);
    const payload = await runTrackedMimCommand(
      runtime,
      { command: "fixes start", project: resolvedProject, metadata: { format: parsedFormat.format, identifier } },
      async () => {
        const fixes = await fetchFixes(runtime, resolvedProject, 100);
        const item = resolveFixItem(fixes, identifier);
        if (typeof item.finding_index !== "number") throw new Error(`fix ${identifier} is missing a finding index`);
        const path = projectPath(`/api/mim/projects/:project/fixes/${item.finding_index}/start`, resolvedProject);
        return mimRequest<unknown>(runtime, path, { method: "POST", body: {} });
      },
    );
    if (parsedFormat.format === "json") printJson(payload);
    else console.log(formatFixStartPayload(payload));
    return;
  }

  if (subcommand === "open") {
    const parsedTarget = parseFixTarget(kept);
    const [identifier, ...unknown] = parsedTarget.args;
    if (!identifier) throw new Error("fixes open requires a rank or finding id");
    if (unknown.length) throw new Error(`unknown fixes open option: ${unknown[0]}`);
    const { url } = await runTrackedMimCommand(
      runtime,
      { command: "fixes open", project: resolvedProject, metadata: { identifier, target: parsedTarget.target || "best" } },
      async () => {
        const fixes = await fetchFixes(runtime, resolvedProject, 100);
        const item = resolveFixItem(fixes, identifier);
        const selectedUrl = fixUrl(item, parsedTarget.target, fixes);
        if (!selectedUrl) {
          const target = parsedTarget.target ? `${parsedTarget.target} ` : "";
          throw new Error(`no ${target}URL is available for fix ${identifier}`);
        }
        return { url: selectedUrl };
      },
    );
    openBrowser(url);
    console.log(url);
    return;
  }

  throw new Error(`unknown fixes command: ${subcommand}`);
}
