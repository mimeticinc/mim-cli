import { fetchMimProjects, noProjectsGuidance, summarizeProjects } from "../account";
import { saveMimConfig } from "../config";
import { formatMimListPayload, parseFormat, printJson } from "../format";
import { mimRequest, requireAuth, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";

async function runProjectsUse(args: string[]): Promise<void> {
  const [key, ...rest] = args;
  if (!key) throw new Error("usage: mim projects use <key>");
  if (rest.length) throw new Error(`unknown projects use option: ${rest[0]}`);
  const { runtime } = runtimeFromArgs([]);
  requireAuth(runtime);
  const projects = await fetchMimProjects(runtime);
  const match = projects.find((project) => project.key === key);
  if (!match) {
    const available = projects.length ? `Available: ${summarizeProjects(projects, 10)}` : "This account has no projects yet.";
    throw new Error(`project "${key}" is not in this account's project list. ${available}`);
  }
  saveMimConfig({ ...runtime.config, defaultProject: match.key });
  console.log(`Default project set to ${match.key}. Every mim command now uses it unless --project overrides.`);
}

export async function runProjects(args: string[]): Promise<void> {
  if (args[0] === "use") return runProjectsUse(args.slice(1));
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
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { projects?: unknown }).projects)
    ? ((payload as { projects: unknown[] }).projects)
    : [];
  if (rows.length === 0) {
    // Guidance goes to stderr so JSON consumers keep parsing stdout cleanly.
    for (const line of noProjectsGuidance(runtime.config.user?.email || "")) console.error(line);
  }
}
