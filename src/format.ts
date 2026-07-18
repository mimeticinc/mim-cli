import { readValue } from "./util";

export type AuditResponse = {
  audit_id?: string;
  auditId?: string;
  status?: string;
  url?: string;
  slug?: string;
  project_key?: string;
  projectKey?: string;
  reused?: boolean;
  refreshing?: boolean;
  progress?: number;
  message?: string;
  report_url?: string;
  reportUrl?: string;
  status_url?: string;
  statusUrl?: string;
};

export type FixState = {
  status?: string;
  label?: string;
  pr_url?: string;
  diff_url?: string;
  preview_url?: string;
  review_url?: string;
  workflow_run_url?: string;
  status_reason?: string;
  updated_at?: string;
};

export type FixItem = {
  id?: string;
  audit_id?: string;
  finding_index?: number;
  rank?: number;
  title?: string;
  severity?: string;
  body?: string;
  status?: string;
  fix_state?: FixState;
  pr_url?: string;
  diff_url?: string;
  preview_url?: string;
  review_url?: string;
  workflow_run_url?: string;
};

export type FixesResponse = {
  project?: { key?: string; name?: string; url?: string };
  report_url?: string;
  audit_id?: string;
  fixes?: FixItem[];
  fixes_enabled?: boolean;
  fix_runner_configured?: boolean;
  github_connected?: boolean;
  can_start_fix?: boolean;
  collector_synced?: boolean;
};

export type BillingStatus = {
  configured?: boolean;
  checkout_configured?: boolean;
  enforced?: boolean;
  paid?: boolean;
  status?: string;
  plan?: string;
  project_key?: string;
  checkout_url?: string;
  portal_url?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
};

export type BillingStatusResponse = {
  billing?: BillingStatus;
};

export function parseFormat(args: string[], defaultFormat: "json" | "markdown"): { format: "json" | "markdown"; args: string[] } {
  let format = defaultFormat;
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      format = "json";
    } else if (arg === "--format") {
      const [value, next] = readValue(args, i, arg);
      if (value !== "json" && value !== "markdown") throw new Error("--format must be json or markdown");
      format = value;
      i = next;
    } else {
      kept.push(arg);
    }
  }
  return { format, args: kept };
}

const MIM_LIST_LIMIT_MAX = 100;

export function parseLimit(args: string[], defaultLimit = 20, maxLimit = MIM_LIST_LIMIT_MAX): { limit: number; args: string[] } {
  let limit = defaultLimit;
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--limit") {
      const [value, next] = readValue(args, i, arg);
      limit = Number(value);
      i = next;
    } else {
      kept.push(arg);
    }
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > maxLimit) throw new Error(`--limit must be an integer between 1 and ${maxLimit}`);
  return { limit, args: kept };
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatMimListPayload(payload: unknown, key: string): string {
  const items = Array.isArray(payload) ? payload : Array.isArray((payload as Record<string, unknown> | null)?.[key]) ? ((payload as Record<string, unknown>)[key] as unknown[]) : [];
  if (items.length === 0) return `No ${key.replace(/_/g, " ")} found.`;
  return items
    .map((item, index) => {
      if (!item || typeof item !== "object") return `${index + 1}. ${String(item)}`;
      const obj = item as Record<string, unknown>;
      const title = obj.name || obj.title || obj.sessionId || obj.id || obj.audit_id || obj.project || `item ${index + 1}`;
      const status = obj.status ? ` status=${obj.status}` : "";
      const url = obj.url || obj.startUrl || obj.start_url || "";
      return `${index + 1}. ${title}${status}${url ? ` ${url}` : ""}`;
    })
    .join("\n");
}

export function auditId(payload: AuditResponse): string {
  return payload.audit_id || payload.auditId || "";
}

export function auditReportUrl(payload: AuditResponse): string {
  return payload.report_url || payload.reportUrl || "";
}

export function auditStatusUrl(payload: AuditResponse): string {
  return payload.status_url || payload.statusUrl || "";
}

export function formatAuditPayload(payload: AuditResponse): string {
  const id = auditId(payload);
  const lines = [
    `Audit ${id || "(unknown)"} status=${payload.status || "unknown"}${payload.progress == null ? "" : ` progress=${payload.progress}%`}`,
  ];
  if (payload.reused) lines.push("Reused an existing audit. Use `mim audit rerun <url>` to force a fresh audit.");
  else if (payload.refreshing) lines.push("Refreshing: a previous report is live at this URL while the fresh run finishes.");
  if (payload.message) lines.push(String(payload.message));
  if (payload.project_key || payload.projectKey) lines.push(`Project: ${payload.project_key || payload.projectKey}`);
  if (auditReportUrl(payload)) lines.push(`Report: ${auditReportUrl(payload)}`);
  if (auditStatusUrl(payload)) lines.push(`Status API: ${auditStatusUrl(payload)}`);
  return lines.join("\n");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function decodeSlackEscapes(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export function displayText(value: unknown): string {
  return decodeSlackEscapes(String(value));
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => displayText(item)).filter(Boolean) : [];
}

export function formatRecordingsPayload(payload: unknown, options: { project?: string } = {}): string {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown> | null)?.recordings)
      ? ((payload as Record<string, unknown>).recordings as unknown[])
      : [];
  if (!items.length) {
    const hint = String((payload as Record<string, unknown> | null)?.hint || "").trim();
    return hint || "No replay insights found yet.";
  }
  const lines = ["# Recent Recordings"];
  for (const item of items) {
    const recording = asRecord(item);
    const summary = asRecord(recording.summary);
    const id = String(recording.session_id || recording.sessionId || recording.id || "");
    const priority = String(recording.priority || "low").toUpperCase();
    const url = String(recording.url || recording.start_url || recording.startUrl || summary.start_url || "");
    const duration = firstDefined(recording.duration_s, recording.durationS, summary.duration_s);
    const events = firstDefined(recording.event_count, recording.eventCount, summary.event_count);
    const clicks = firstDefined(recording.click_count, recording.clickCount, summary.click_count);
    const inputs = firstDefined(recording.input_count, recording.inputCount, summary.input_count);
    const errors = firstDefined(recording.console_error_count, recording.consoleErrorCount, summary.console_error_count);
    const device = String(recording.device || summary.device || "");
    const userAgent = String(recording.user_agent || recording.userAgent || summary.user_agent || "");
    const source = String(recording.interpretation_source || recording.interpretationSource || "");

    lines.push("", `## ${id || "session"} [${priority}]`);
    if (url) lines.push(`URL: ${url}`);
    const counts = [
      duration == null ? "" : `Duration: ${duration}s`,
      events == null ? "" : `Events: ${events}`,
      clicks == null ? "" : `Clicks: ${clicks}`,
      inputs == null ? "" : `Inputs: ${inputs}`,
      errors == null ? "" : `Console errors: ${errors}`,
    ].filter(Boolean);
    if (counts.length) lines.push(counts.join(" | "));
    if (device) lines.push(`Device: ${device}`);
    if (userAgent) lines.push(`User agent: ${userAgent}`);
    if (source) lines.push(`Insight source: ${source}`);

    const whatHappened = stringList(recording.what_happened || recording.whatHappened);
    if (whatHappened.length) {
      lines.push("What happened:");
      for (const detail of whatHappened) lines.push(`- ${detail}`);
    }
    const likelyFriction = stringList(recording.likely_friction || recording.likelyFriction);
    if (likelyFriction.length) {
      lines.push("Likely friction:");
      for (const detail of likelyFriction) lines.push(`- ${detail}`);
    }
    if (!whatHappened.length && !likelyFriction.length && id) {
      lines.push(`Insight details: run mim replay ${id}.`);
    }
    if (id) {
      const projectArg = options.project ? ` --project ${options.project}` : "";
      lines.push(`Replay: mim replay ${id}${projectArg}`);
    }
  }
  return lines.join("\n");
}

function replayInsightFromPayload(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const insight = asRecord(root.insight);
  if (Object.keys(insight).length) return insight;
  const recording = asRecord(root.recording);
  if (Object.keys(recording).length) return recording;
  return root;
}

export function formatReplayInsightPayload(payload: unknown): string {
  const insight = replayInsightFromPayload(payload);
  const summary = asRecord(insight.summary);
  const sessionId = String(insight.session_id || insight.sessionId || insight.id || "");
  const title = sessionId ? `Replay ${sessionId}` : "Replay insight";
  const lines = [`# ${title}`];
  const priority = insight.priority ? String(insight.priority).toUpperCase() : "";
  const url = String(insight.url || insight.start_url || summary.start_url || "");
  const device = String(insight.device || summary.device || "");
  const userAgent = String(insight.user_agent || insight.userAgent || summary.user_agent || "");
  const source = String(insight.interpretation_source || insight.interpretationSource || "");
  const touchedAt = insight.touched_at_ms || insight.touchedAtMs || insight.touched_at || "";

  if (priority) lines.push(`Priority: ${priority}`);
  if (url) lines.push(`URL: ${url}`);
  if (device) lines.push(`Device: ${device}`);
  if (userAgent) lines.push(`User agent: ${userAgent}`);
  if (source) lines.push(`Insight source: ${source}`);
  if (touchedAt) lines.push(`Touched at: ${touchedAt}`);

  const whatHappened = stringList(insight.what_happened || insight.whatHappened);
  if (whatHappened.length) {
    lines.push("", "## What Happened", ...whatHappened.map((item) => `- ${item}`));
  }

  const likelyFriction = stringList(insight.likely_friction || insight.likelyFriction);
  if (likelyFriction.length) {
    lines.push("", "## Likely Friction", ...likelyFriction.map((item) => `- ${item}`));
  }

  const interpretation = asRecord(insight.interpretation);
  const issues = Array.isArray(interpretation.issues) ? interpretation.issues : [];
  if (issues.length) {
    lines.push("", "## Interpreted Issues");
    for (const issue of issues.slice(0, 8)) {
      const item = asRecord(issue);
      const severity = item.severity ? `[${String(item.severity).toUpperCase()}] ` : "";
      const issueTitle = displayText(item.title || "Issue");
      const wrong = item.what_went_wrong ? `: ${displayText(item.what_went_wrong)}` : "";
      const cause = item.likely_cause ? ` Likely cause: ${displayText(item.likely_cause)}` : "";
      lines.push(`- ${severity}${issueTitle}${wrong}${cause}`);
    }
  }

  const narrative = String(insight.narrative || "").trim();
  if (narrative) {
    lines.push("", "## Redacted Narrative", "```csv", narrative, "```");
  }

  return lines.join("\n");
}

export function formatAnalyticsSetupPayload(payload: unknown): string {
  const root = asRecord(payload);
  const lines = [`Analytics setup: ${String(root.status || "unknown")}`];
  if (root.message) lines.push(String(root.message));
  if (root.measurement_id) lines.push(`GA4 measurement ID: ${root.measurement_id}`);
  if (root.review_url) lines.push(`Install PR: ${root.review_url}`);
  if (root.gsc_verified != null) lines.push(`Search Console verified: ${root.gsc_verified ? "yes" : "not yet"}`);
  if (root.gsc_identity) lines.push(`Search Console identity: ${root.gsc_identity}`);
  if (root.embed_enabled != null) lines.push(`Shopify embed enabled: ${root.embed_enabled ? "yes" : "no"}`);
  if (root.updated_at) lines.push(`Updated: ${root.updated_at}`);
  const agent = asRecord(root.agent_install);
  if (agent.snippet) {
    lines.push("", "Apply this snippet to the site's shared <head>:", "", String(agent.snippet));
    if (agent.next) lines.push("", String(agent.next));
  }
  return lines.join("\n");
}

export function formatAdsStatusPayload(payload: unknown): string {
  const root = asRecord(payload);
  const lines = [`Google Ads: ${root.connected ? "linked" : "not linked"}`];
  if (root.customer_id) lines.push(`Customer ID: ${root.customer_id}`);
  const account = asRecord(root.account);
  if (account.name) lines.push(`Account: ${account.name}${account.currency ? ` (${account.currency})` : ""}`);
  if (root.credential_source) lines.push(`Query credentials: ${root.credential_source}`);
  const lastEvent = asRecord(root.last_event);
  if (lastEvent.event) lines.push(`Last setup event: ${lastEvent.event}${lastEvent.at ? ` at ${lastEvent.at}` : ""}`);
  if (root.message) lines.push(String(root.message));
  if (!root.connected && root.connect_url) lines.push(`Connect an existing account: ${root.connect_url}`);
  return lines.join("\n");
}

export function fixesFromPayload(payload: FixesResponse): FixItem[] {
  return Array.isArray(payload.fixes) ? payload.fixes.filter((item) => item && typeof item === "object") : [];
}

export function fixState(item: FixItem): FixState {
  return item.fix_state && typeof item.fix_state === "object" ? item.fix_state : {};
}

export function fixUrl(item: FixItem, target: string, payload?: FixesResponse): string {
  const state = fixState(item);
  const byTarget: Record<string, string> = {
    review: String(item.review_url || state.review_url || ""),
    preview: String(item.preview_url || state.preview_url || ""),
    pr: String(item.pr_url || state.pr_url || ""),
    diff: String(item.diff_url || state.diff_url || ""),
    workflow: String(item.workflow_run_url || state.workflow_run_url || ""),
    report: String(payload?.report_url || ""),
  };
  if (target) return byTarget[target] || "";
  return byTarget.review || byTarget.preview || byTarget.pr || byTarget.diff || byTarget.workflow || byTarget.report || "";
}

export function formatFixesPayload(payload: FixesResponse): string {
  const project = payload.project || {};
  const name = project.name || project.key || "project";
  const lines = [`# Fixes: ${name}`];
  if (project.url) lines.push(`Site: ${project.url}`);
  if (payload.report_url) lines.push(`Report: ${payload.report_url}`);
  if (!payload.can_start_fix) {
    const missing = [
      payload.fixes_enabled ? "" : "fixes disabled",
      payload.fix_runner_configured ? "" : "fix runner not configured",
      payload.github_connected ? "" : "GitHub not connected",
    ].filter(Boolean);
    if (missing.length) lines.push(`Start fix unavailable: ${missing.join(", ")}`);
  }

  const fixes = fixesFromPayload(payload);
  if (!fixes.length) {
    lines.push("", "No fixes found.");
    return lines.join("\n");
  }

  for (const item of fixes) {
    const state = fixState(item);
    const rank = item.rank || (typeof item.finding_index === "number" ? item.finding_index + 1 : fixes.indexOf(item) + 1);
    const severity = String(item.severity || "medium").toUpperCase();
    const label = state.label || state.status || "Not requested";
    lines.push("", `${rank}. [${severity}] ${item.title || `Finding ${rank}`}`);
    lines.push(`   State: ${label}`);
    if (item.status) lines.push(`   Finding status: ${item.status}`);
    const review = fixUrl(item, "review", payload);
    const preview = fixUrl(item, "preview", payload);
    const pr = fixUrl(item, "pr", payload);
    const diff = fixUrl(item, "diff", payload);
    const workflow = fixUrl(item, "workflow", payload);
    if (review) lines.push(`   Review: ${review}`);
    if (preview) lines.push(`   Preview: ${preview}`);
    if (pr) lines.push(`   PR: ${pr}`);
    if (diff) lines.push(`   Diff: ${diff}`);
    if (workflow) lines.push(`   Workflow: ${workflow}`);
  }
  return lines.join("\n");
}

export function formatFixStartPayload(payload: unknown): string {
  const root = asRecord(payload);
  const lines = [String(root.message || "Fix request submitted.")];
  const issue = asRecord(root.issue);
  if (issue.title) lines.push(`Issue: ${issue.title}`);
  if (issue.rank) lines.push(`Rank: ${issue.rank}`);
  if (root.workflow_url) lines.push(`Workflow: ${root.workflow_url}`);
  return lines.join("\n");
}

export function formatBillingStatus(payload: BillingStatusResponse): string {
  const billing = payload.billing || {};
  const lines = [
    `Billing: ${billing.paid ? "active" : "not active"}`,
    `Project: ${billing.project_key || "(unknown)"}`,
    `Plan: ${billing.plan || "free"}`,
    `Status: ${billing.status || "none"}`,
    `Enforced: ${billing.enforced ? "yes" : "no"}`,
  ];
  if (billing.current_period_end) lines.push(`Current period ends: ${billing.current_period_end}`);
  if (billing.cancel_at_period_end) lines.push("Cancel at period end: yes");
  if (billing.checkout_url && !billing.paid) lines.push(`Checkout: ${billing.checkout_url}`);
  if (billing.portal_url && billing.paid) lines.push(`Portal: ${billing.portal_url}`);
  return lines.join("\n");
}
