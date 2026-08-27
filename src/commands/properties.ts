import { asRecord, parseFormat, printJson } from "../format";
import { requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { callMimMcpTool } from "./query";

export type Ga4PropertyRow = {
  id?: string;
  name?: string;
  account?: string;
  websiteUrl?: string;
  sessions_28d?: number | null;
  selected?: boolean;
};

function propertyRows(payload: unknown): Ga4PropertyRow[] {
  const record = asRecord(payload);
  return Array.isArray(record.properties) ? (record.properties as Ga4PropertyRow[]) : [];
}

export function formatPropertiesPayload(payload: unknown): string {
  const record = asRecord(payload);
  const rows = propertyRows(payload);
  const lines: string[] = [];
  const selectedId = record.selected_property_id == null ? "" : String(record.selected_property_id);
  if (selectedId) {
    lines.push(`Current GA4 property: ${selectedId} (${String(record.selected_property_name || "unnamed")})`);
  } else {
    lines.push("No GA4 property is selected for this project yet.");
  }
  const account = String(record.connected_google_account || "");
  if (account) lines.push(`Connected Google account: ${account}`);
  if (!rows.length) {
    lines.push("No GA4 properties are visible to this connection.");
    return lines.join("\n");
  }
  lines.push("");
  const header = ["", "id", "name", "account", "website", "sessions28d"];
  const body = rows.map((row) => [
    row.selected ? "*" : "",
    String(row.id ?? ""),
    String(row.name ?? ""),
    String(row.account ?? ""),
    String(row.websiteUrl ?? ""),
    row.sessions_28d == null ? "-" : String(row.sessions_28d),
  ]);
  const widths = header.map((cell, i) => Math.max(cell.length, ...body.map((r) => r[i].length)));
  for (const row of [header, ...body]) {
    lines.push(row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
  }
  if (record.note) lines.push("", String(record.note));
  // No verdict here on purpose. Every rule tried so far was fitted to one
  // incident: "zero sessions" cried wolf at a new store, and a ratio needed two
  // invented constants. The table already shows each candidate's sessions next
  // to the selected one, so a wrong pick reads as 0 beside 52,347 without
  // anyone having to guess a threshold on the reader's behalf.
  lines.push("", "Switch with `mim properties use <id>`.");
  return lines.join("\n");
}

export function formatPropertySetPayload(payload: unknown): string {
  const record = asRecord(payload);
  const selected = asRecord(record.selected);
  const previous = asRecord(record.previous);
  const lines = [
    String(record.message || `GA4 property set to ${String(selected.property_id ?? "(unknown)")}.`),
  ];
  if (previous.property_id && previous.property_id !== selected.property_id) {
    lines.push(`Previous property: ${String(previous.property_id)} (${String(previous.property_name || "unnamed")})`);
  }
  return lines.join("\n");
}

async function runPropertiesUse(args: string[]): Promise<void> {
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  const [id, ...rest] = kept;
  if (!id) throw new Error("usage: mim properties use <property_id>");
  if (rest.length) throw new Error(`unknown properties use option: ${rest[0]}`);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "properties use", project: resolvedProject },
    () => callMimMcpTool(runtime, "set_ga4_property", { project: resolvedProject, property_id: id }),
  );
  console.log(formatPropertySetPayload(payload));
}

export async function runProperties(args: string[]): Promise<void> {
  if (args[0] === "use") return runPropertiesUse(args.slice(1));
  const { runtime, args: kept, project } = runtimeFromArgs(args);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);
  const { format, args: afterFormat } = parseFormat(kept, "json");
  if (afterFormat.length) throw new Error(`unknown properties option: ${afterFormat[0]}`);
  const payload = await runTrackedMimCommand(
    runtime,
    { command: "properties", project: resolvedProject, metadata: { format } },
    () => callMimMcpTool(runtime, "list_ga4_properties", { project: resolvedProject }),
  );
  if (format === "json") printJson(payload);
  else console.log(formatPropertiesPayload(payload));
}
