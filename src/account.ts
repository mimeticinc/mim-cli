import { MimConfig, saveMimConfig } from "./config";
import { MimRuntime, mimRequest } from "./runtime";

export type MimProjectSummary = {
  key: string;
  name: string;
  url: string;
};

export type AccountCheck =
  | { valid: true; projects: MimProjectSummary[] }
  | { valid: false; reason: string };

type FetchLike = typeof fetch;

function projectFromRecord(value: unknown): MimProjectSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key) return null;
  return {
    key,
    name: typeof record.name === "string" ? record.name : "",
    url: typeof record.url === "string" ? record.url : "",
  };
}

export function parseProjectsPayload(payload: unknown): MimProjectSummary[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows = (payload as { projects?: unknown }).projects;
  if (!Array.isArray(rows)) return [];
  return rows.map(projectFromRecord).filter((row): row is MimProjectSummary => row !== null);
}

export async function fetchMimProjects(runtime: MimRuntime, fetchImpl: FetchLike = fetch): Promise<MimProjectSummary[]> {
  const payload = await mimRequest<unknown>(runtime, "/api/mim/projects", {}, fetchImpl);
  return parseProjectsPayload(payload);
}

// Verifies a token by making a real API call instead of trusting local state.
// 401/403 means the token is dead; every other failure is surfaced as-is so
// network problems are not mistaken for revoked credentials.
export async function checkMimAccount(runtime: MimRuntime, fetchImpl: FetchLike = fetch): Promise<AccountCheck> {
  try {
    const projects = await fetchMimProjects(runtime, fetchImpl);
    return { valid: true, projects };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/failed with 40[13]\b/.test(message)) {
      return { valid: false, reason: message };
    }
    throw error;
  }
}

export function describeTokenSource(env: NodeJS.ProcessEnv = process.env): string {
  return env.MIM_API_TOKEN?.trim() ? "MIM_API_TOKEN environment variable" : "~/.mim/config.json";
}

export function summarizeProjects(projects: MimProjectSummary[], max = 5): string {
  const keys = projects.map((project) => project.key);
  const shown = keys.slice(0, max).join(", ");
  const extra = keys.length > max ? ` and ${keys.length - max} more` : "";
  return `${shown}${extra}`;
}

// The lines a user needs when their login worked but the account owns nothing.
// This is the multi-email trap: projects belong to the email the Mimetic audit
// or report was sent to, which is often a work address, while people sign the
// CLI in with a personal address.
export function noProjectsGuidance(email: string): string[] {
  const who = email || "this account";
  return [
    `No projects are linked to ${who} yet.`,
    "Projects belong to the email your Mimetic audit or report was sent to.",
    "If that was a different email (for example a work address), sign in with it instead:",
    "  mim auth login --force",
    "Or start your first audit:",
    "  mim audit start https://yoursite.com",
  ];
}

// Saves the only project as the default so every later command works without
// --project. Never overwrites a default the user already has, and never
// guesses when there is more than one project.
export function ensureDefaultProject(config: MimConfig, projects: MimProjectSummary[]): string {
  const existing = config.defaultProject?.trim() || "";
  if (existing) return existing;
  if (projects.length !== 1) return "";
  const key = projects[0].key;
  saveMimConfig({ ...config, defaultProject: key });
  return key;
}
