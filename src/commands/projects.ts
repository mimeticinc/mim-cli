import { formatMimListPayload, parseFormat, printJson } from "../format";
import { mimRequest, requireAuth, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";

export async function runProjects(args: string[]): Promise<void> {
  const { runtime, args: kept } = runtimeFromArgs(args);
  requireAuth(runtime);
  const { format, args: afterFormat } = parseFormat(kept, "json");
  if (afterFormat.length) throw new Error(`unknown projects option: ${afterFormat[0]}`);
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "projects", metadata: { format } },
    () => mimRequest<unknown>(runtime, "/api/mim/projects"),
  );
  if (format === "json") printJson(payload);
  else console.log(formatMimListPayload(payload, "projects"));
}
