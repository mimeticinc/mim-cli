import { formatMimListPayload, formatRecordingsPayload, formatReplayInsightPayload, parseFormat, parseLimit, printJson } from "../format";
import { mimRequest, projectPath, requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";

export async function runContext(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "markdown");
  const parsedLimit = parseLimit(parsedFormat.args, 20);
  if (parsedLimit.args.length) throw new Error(`unknown context option: ${parsedLimit.args[0]}`);
  const path = projectPath(`/api/mim/projects/:project/context?format=${parsedFormat.format}&limit=${parsedLimit.limit}`, resolvedProject);
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "context", project: resolvedProject, metadata: { format: parsedFormat.format, limit: parsedLimit.limit } },
    () => mimRequest<string | unknown>(runtime, path, { acceptText: parsedFormat.format === "markdown" }),
  );
  if (parsedFormat.format === "json") printJson(payload);
  else console.log(String(payload).trim());
}

export async function runCollectionCommand(command: "recordings" | "findings", args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, command === "recordings" ? "markdown" : "json");
  const parsedLimit = parseLimit(parsedFormat.args, 20);
  if (parsedLimit.args.length) throw new Error(`unknown ${command} option: ${parsedLimit.args[0]}`);
  const path = projectPath(`/api/mim/projects/:project/${command}?limit=${parsedLimit.limit}`, resolvedProject);
  const payload = await runTrackedMimCommand(
    runtime,
    { command, project: resolvedProject, metadata: { format: parsedFormat.format, limit: parsedLimit.limit } },
    () => mimRequest<unknown>(runtime, path),
  );
  if (parsedFormat.format === "json") printJson(payload);
  else if (command === "recordings") console.log(formatRecordingsPayload(payload, { project: resolvedProject }));
  else console.log(formatMimListPayload(payload, command));
}

export async function runReplay(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const parsedFormat = parseFormat(kept, "markdown");
  let sessionId = "";
  let latest = false;

  for (let i = 0; i < parsedFormat.args.length; i += 1) {
    const arg = parsedFormat.args[i];
    if (arg === "--latest") {
      latest = true;
    } else if (arg === "--session" || arg === "--session-id") {
      const [value, next] = readValue(parsedFormat.args, i, arg);
      sessionId = value;
      i = next;
    } else if (!sessionId) {
      sessionId = arg;
    } else {
      throw new Error(`unknown replay option: ${arg}`);
    }
  }

  if (!sessionId || sessionId === "latest") {
    sessionId = "latest";
    latest = true;
  }

  const path = projectPath(`/api/mim/projects/:project/recordings/${encodeURIComponent(sessionId)}`, resolvedProject);
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "replay", project: resolvedProject, metadata: { format: parsedFormat.format, session_id: latest ? "latest" : sessionId } },
    () => mimRequest<unknown>(runtime, path),
  );
  if (parsedFormat.format === "json") printJson(payload);
  else console.log(formatReplayInsightPayload(payload));
}
