#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { DEFAULT_MIM_API_BASE_URL, MIM_CLIENT_VERSION } from "./config";
import { runAds } from "./commands/ads";
import { runAudit } from "./commands/audit";
import { runAuth } from "./commands/auth";
import { runBilling } from "./commands/billing";
import { runCollectionCommand, runContext, runReplay } from "./commands/collections";
import { runFixes } from "./commands/fixes";
import { runKlaviyo } from "./commands/klaviyo";
import { runMcp } from "./commands/mcp-config";
import { runPostHog } from "./commands/posthog";
import { runProjects } from "./commands/projects";
import { runQuery } from "./commands/query";
import { runSetup } from "./commands/setup";
import { runSetupAnalytics } from "./commands/analytics";

export function mimUsage(): string {
  return `mim

TryMimetic growth context for Claude Code, Codex, and shell workflows.

Commands:
  setup                      One command that gets a new machine working: install
                             check, sign in, project detection, Claude Code MCP
                             registration, and a live verification of each step.
                             Safe to re-run; it reuses an existing login.
  auth login [--no-open]     Authenticate this machine; print the URL without opening a browser.
  auth login --force         Sign in again as a different account.
  auth status                Show and verify the active account, projects, and default project.
  auth logout                Revoke the stored token and remove local credentials.
  auth logout --local-only   Remove only this machine's stored credentials.
  projects                   List projects/sites available to this account.
  projects use <key>         Save a default project so --project is not needed.
  context                    Print a growth context pack for a project.
  recordings                 List recent session recording summaries.
  replay [session_id]        Print one persisted replay insight. Defaults to latest.
  findings                   List audit/backlog findings from TryMimetic.
  query-ga4                  Query your connected GA4 (needs --metrics, e.g. sessions).
  query-gsc                  Query your connected Search Console (top queries/pages).
  setup-analytics            One-click hosted analytics setup for a project's site:
                             GA4 property + tag install (PR or Shopify pixel) + Search
                             Console verification. Runs in the background.
  setup-analytics --status   Check hosted setup progress (also retries the Search
                             Console verification/sitemap followups).
  setup-analytics --channel agent
                             For coding agents in the site's repo: provision only,
                             then apply the returned snippet yourself (no PR pipeline).
  ads setup                  Create a Google Ads account for the site under Mimetic's
                             manager account, linked to GA4, owner invited as ADMIN.
  ads status                 Show the project's linked Google Ads account.
  ads query [--gaql <q>]     Read-only GAQL report (default: campaign perf, 30 days).
  posthog connect            Connect PostHog over OAuth (prints the approval URL).
  posthog query [--hogql <q>]
                             Read-only HogQL over the connected PostHog project
                             (default: daily events + unique users, 14 days).
  klaviyo connect            Connect Klaviyo over OAuth (prints the approval URL).
  klaviyo query [--resource <r>] [--timeframe <t>]
                             Read-only Klaviyo queries: listings (campaigns, flows,
                             lists, segments, metrics), performance reports
                             (campaign_performance, flow_performance), and checks
                             (abandoned_cart_status, dead_links).
  audit start <url>          Start an audit, reusing a running/completed audit when available.
  audit rerun <url>          Force a fresh audit for a site that was already audited.
  audit status <audit_id>    Check audit progress.
  audit wait <audit_id>      Poll until an audit completes or fails.
  fixes list                 List fixable findings and PR/review state.
  fixes start <rank>         Queue a code fix for a finding from fixes list.
  fixes open <rank>          Open the PR, review, preview, or workflow for a fix.
  billing status             Show Mimetic billing status for a project.
  billing checkout [plan]    Print a Stripe Checkout URL. Plan defaults to starter.
  billing open [plan]        Open Stripe Checkout in your browser.
  billing portal             Open the Stripe billing portal when available.
  mcp                        Print MCP setup help.
  mcp install claude         Register the mim MCP server with Claude Code (user
                             scope), verify it, and fall back to Claude Desktop.
  mcp install claude --print Print the underlying claude mcp add command instead.
  mcp install desktop        Add the mim server to Claude Desktop's config file.
  mcp install codex          Print Codex MCP config.

Common options:
  -V, --version              Print the installed CLI version.
  --project <key>            Project/site key. Defaults to MIM_PROJECT or saved default.
  --format <json|markdown>   Output format. Default: markdown for context, json for lists.
  --limit <n>                Number of items to request, up to 100. Default: 20.
  --api-base-url <url>       TryMimetic API origin. Default: MIM_API_BASE_URL or ${DEFAULT_MIM_API_BASE_URL}.
  --json                     Alias for --format json.
  --mode <slim|full>         Audit mode. Default: slim. full adds deeper checks and SDK intel.
  --wait                     With audit start/rerun or setup-analytics, poll until completion.
  --target <kind>            With fixes open, choose review, preview, pr, diff, workflow, or report.
  --print                    With mcp install claude, print the install command instead of running it.

Environment:
  MIM_API_TOKEN              Overrides the locally stored access token.
  MIM_API_BASE_URL           TryMimetic API origin.
  MIM_PROJECT                Default project/site key.
  MIM_CONFIG_DIR             Credential directory. Default: ~/.mim.
  MIM_ALLOW_INSECURE_HTTP=1  Allow non-loopback HTTP for local development only.
  MIM_TELEMETRY=0            Disable metadata-only CLI/MCP usage events.
  MIM_DISABLE_TELEMETRY=1    Disable metadata-only CLI/MCP usage events.
`;
}

export async function mimMain(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;
  if (command === "-V" || command === "--version") {
    console.log(MIM_CLIENT_VERSION);
    return;
  }
  if (!command || command === "-h" || command === "--help") {
    console.log(mimUsage());
    return;
  }
  if (command === "setup" || command === "init") return runSetup(args);
  if (command === "auth") return runAuth(args);
  if (command === "projects") return runProjects(args);
  if (command === "context") return runContext(args);
  if (command === "recordings") return runCollectionCommand("recordings", args);
  if (command === "replay") return runReplay(args);
  if (command === "findings") return runCollectionCommand("findings", args);
  if (command === "query-ga4") return runQuery("query_ga4", args);
  if (command === "query-gsc") return runQuery("query_gsc", args);
  if (command === "setup-analytics") return runSetupAnalytics(args);
  if (command === "ads") return runAds(args);
  if (command === "posthog") return runPostHog(args);
  if (command === "klaviyo") return runKlaviyo(args);
  if (command === "audit") return runAudit(args);
  if (command === "fixes") return runFixes(args);
  if (command === "billing") return runBilling(args);
  if (command === "mcp") return runMcp(args);
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mimMain().catch((error: unknown) => {
    console.error(`mim: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

// Public surface. Re-exported so existing imports of "./mim-cli" (tests, bins, and
// mim-mcp-stdio.ts) keep resolving without changes.
export type { MimConfig } from "./config";
export type { MimRuntime } from "./runtime";
export {
  MIM_CLIENT_VERSION,
  mimConfigDir,
  mimConfigPath,
  loadMimConfig,
  saveMimConfig,
  clearMimConfig,
  normalizeMimApiBaseUrl,
  mimApiBaseUrl,
  mimAuthToken,
  defaultMimProject,
} from "./config";
export {
  shouldSendMimTelemetry,
  sanitizeMimMetadata,
  buildMimUsageEvent,
  trackMimUsageEvent,
} from "./telemetry";
export { formatMimListPayload, formatRecordingsPayload, formatReplayInsightPayload, formatAnalyticsSetupPayload, formatAdsStatusPayload, formatFixesPayload } from "./format";
export { buildQueryToolArgs } from "./commands/query";
export { parseSetupAnalyticsArgs } from "./commands/analytics";
export { parseAdsArgs } from "./commands/ads";
export { parsePostHogArgs } from "./commands/posthog";
export { parseKlaviyoArgs } from "./commands/klaviyo";
export {
  claudeMcpInstallCommand,
  claudeDesktopConfigPath,
  codexMcpConfig,
  mergeMcpServersConfig,
  mimMcpServerEntry,
  probeMimMcpEndpoint,
  registerClaudeCodeMcp,
} from "./commands/mcp-config";
export { findOnPath, pathFixLines } from "./commands/setup";
export { checkMimAccount, ensureDefaultProject, fetchMimProjects, noProjectsGuidance, parseProjectsPayload, summarizeProjects } from "./account";
export { ensureLoggedIn } from "./commands/auth";
