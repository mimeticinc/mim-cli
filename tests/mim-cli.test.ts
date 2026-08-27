import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import packageJson from "../package.json";
import {
  buildMimUsageEvent,
  buildQueryToolArgs,
  claudeMcpInstallCommand,
  codexMcpConfig,
  formatAdsStatusPayload,
  formatAnalyticsSetupPayload,
  formatFixesPayload,
  formatMimListPayload,
  formatRecordingsPayload,
  formatReplayInsightPayload,
  mimConfigDir,
  mimConfigPath,
  mimMain,
  mimUsage,
  normalizeMimApiBaseUrl,
  parseAdsArgs,
  parseKlaviyoArgs,
  parsePostHogArgs,
  parseSetupAnalyticsArgs,
  sanitizeMimMetadata,
  saveMimConfig,
  shouldSendMimTelemetry,
} from "../src/mim-cli";

describe("mim CLI helpers", () => {
  it("normalizes TryMimetic API origins", () => {
    expect(normalizeMimApiBaseUrl("https://trymimetic.com/")).toBe("https://trymimetic.com");
    expect(() => normalizeMimApiBaseUrl("ftp://trymimetic.com")).toThrow("must use http or https");
    expect(() => normalizeMimApiBaseUrl("not-a-url")).toThrow("must be an absolute http(s) URL");
    expect(() => normalizeMimApiBaseUrl("http://api.example.com")).toThrow("must use https");
    expect(normalizeMimApiBaseUrl("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(normalizeMimApiBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(normalizeMimApiBaseUrl("http://[::1]:8787/")).toBe("http://[::1]:8787");
    expect(normalizeMimApiBaseUrl("http://dev.example.com", "test URL", {
      MIM_ALLOW_INSECURE_HTTP: "1",
    })).toBe("http://dev.example.com");
    expect(() => normalizeMimApiBaseUrl("https://user:password@example.com")).toThrow("must not include URL credentials");
  });

  it.skipIf(process.platform === "win32")("repairs restrictive credential permissions on every save", () => {
    const root = mkdtempSync(join(tmpdir(), "mim-config-test-"));
    const env = { MIM_CONFIG_DIR: join(root, "credentials") };
    try {
      mkdirSync(mimConfigDir(env), { recursive: true, mode: 0o777 });
      writeFileSync(mimConfigPath(env), '{"accessToken":"old"}\n', { mode: 0o666 });
      chmodSync(mimConfigDir(env), 0o777);
      chmodSync(mimConfigPath(env), 0o666);

      saveMimConfig({ accessToken: "new" }, env);

      expect(statSync(mimConfigDir(env)).mode & 0o777).toBe(0o700);
      expect(statSync(mimConfigPath(env)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("documents auth, context, MCP, and telemetry controls", () => {
    const usage = mimUsage();

    expect(usage).toContain("auth login");
    expect(usage).toContain("auth login [--no-open]");
    expect(usage).toContain("context");
    expect(usage).toContain("replay [session_id]");
    expect(usage).toContain("audit start");
    expect(usage).toContain("audit rerun");
    expect(usage).toContain("audit wait");
    expect(usage).toContain("fixes list");
    expect(usage).toContain("fixes start");
    expect(usage).toContain("billing status");
    expect(usage).toContain("billing checkout");
    expect(usage).toContain("mcp install claude");
    expect(usage).toContain("MIM_TELEMETRY=0");
    expect(usage).toContain("auth logout --local-only");
    expect(usage).toContain("MIM_ALLOW_INSECURE_HTTP=1");
    expect(usage).not.toContain("auth login --token");
    expect(usage).not.toContain("web-audit");
    expect(usage).not.toContain("ipa-audit");
    expect(usage).not.toContain("MIM_IOS_AUDIT_TOOL_DIR");
  });

  it("prints the installed package version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await mimMain(["--version"]);
      await mimMain(["-V"]);
      expect(log).toHaveBeenNthCalledWith(1, packageJson.version);
      expect(log).toHaveBeenNthCalledWith(2, packageJson.version);
    } finally {
      log.mockRestore();
    }
  });

  it("builds MCP install snippets for Claude Code and Codex", () => {
    expect(claudeMcpInstallCommand("dubbah")).toEqual([
      "claude",
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "mim",
      "--",
      "npx",
      "-y",
      "--package",
      "@mimeticinc/mim-cli",
      "mim-mcp",
      "--project",
      "dubbah",
    ]);
    expect(codexMcpConfig("dubbah")).toContain("[mcp_servers.mim]");
    expect(codexMcpConfig("dubbah")).toContain('"mim-mcp"');
    expect(codexMcpConfig("dubbah")).toContain('"dubbah"');
  });

  it("keeps telemetry metadata bounded and redacts sensitive fields", () => {
    const event = buildMimUsageEvent({
      event: "cli_command",
      trace_id: "trace-1",
      client: "mim-cli",
      command: "context",
      metadata: {
        token: "secret",
        session_id: "private-session",
        prompt: "should not be stored",
        limit: 20,
        nested: { narrative: "private", safe: "ok" },
      },
    });

    expect(event.client_version).toBe(packageJson.version);
    expect(event.metadata).toMatchObject({
      token: "[redacted]",
      session_id: "[redacted]",
      prompt: "[redacted]",
      limit: 20,
      nested: { narrative: "[redacted]", safe: "ok" },
    });
    expect(sanitizeMimMetadata("x".repeat(300))).toHaveLength(240);
  });

  it("lets users opt out of metadata telemetry", () => {
    expect(shouldSendMimTelemetry({})).toBe(true);
    expect(shouldSendMimTelemetry({ MIM_TELEMETRY: "0" })).toBe(false);
    expect(shouldSendMimTelemetry({ MIM_DISABLE_TELEMETRY: "1" })).toBe(false);
  });

  it("formats project and finding lists for shell output", () => {
    expect(formatMimListPayload({ projects: [{ name: "Dubbah", url: "https://dubbah.co" }] }, "projects")).toContain(
      "Dubbah https://dubbah.co",
    );
    expect(formatMimListPayload({ findings: [] }, "findings")).toBe("No findings found.");
  });

  it("formats recording lists with Slack-style insight fields", () => {
    const output = formatRecordingsPayload(
      {
        recordings: [
          {
            session_id: "sess-1",
            priority: "high",
            url: "https://example.com/pricing",
            duration_s: 0,
            event_count: 120,
            click_count: 8,
            input_count: 1,
            console_error_count: 0,
            device: "desktop; Chrome",
            user_agent: "Mozilla/5.0",
            what_happened: [
              "Viewed pricing",
              "Clicked checkout",
              "Scrolled FAQ",
              "Returned to pricing",
              "Clicked &lt;button&gt; checkout &amp; subscribe",
            ],
            likely_friction: ["Returned to pricing after checkout click", "Repeated &lt;button&gt; click"],
          },
        ],
      },
      { project: "trymimetic" },
    );

    expect(output).toContain("# Recent Recordings");
    expect(output).toContain("## sess-1 [HIGH]");
    expect(output).toContain("Duration: 0s");
    expect(output).toContain("Console errors: 0");
    expect(output).toContain("What happened:");
    expect(output).toContain("Likely friction:");
    expect(output).toContain("Clicked <button> checkout & subscribe");
    expect(output).toContain("Repeated <button> click");
    expect(output).toContain("Replay: mim replay sess-1 --project trymimetic");
  });

  it("does not make empty recording insight lists look like useful data", () => {
    expect(formatRecordingsPayload({ recordings: [], hint: "No persisted insights yet." })).toBe("No persisted insights yet.");
    expect(formatRecordingsPayload({ recordings: [] })).toContain("No replay insights found");
  });

  it("formats fix states with review links and setup blockers", () => {
    const output = formatFixesPayload({
      project: { key: "dubbah", name: "Dubbah", url: "https://dubbah.co" },
      report_url: "https://trymimetic.com/site-report/audit-1",
      fixes_enabled: true,
      fix_runner_configured: true,
      github_connected: true,
      can_start_fix: true,
      fixes: [
        {
          rank: 1,
          finding_index: 0,
          title: "Clarify pricing CTA",
          severity: "high",
          status: "pending",
          fix_state: {
            label: "PR ready",
            review_url: "https://trymimetic.com/review?preview=1",
            pr_url: "https://github.com/example/repo/pull/1",
          },
        },
      ],
    });

    expect(output).toContain("# Fixes: Dubbah");
    expect(output).toContain("1. [HIGH] Clarify pricing CTA");
    expect(output).toContain("State: PR ready");
    expect(output).toContain("Review: https://trymimetic.com/review?preview=1");
    expect(output).toContain("PR: https://github.com/example/repo/pull/1");
  });

  it("formats replay insights with narrative detail", () => {
    const output = formatReplayInsightPayload({
      insight: {
        session_id: "sess-1",
        priority: "high",
        url: "https://example.com/create",
        device: "desktop; Chrome 126",
        user_agent: "Mozilla/5.0",
        interpretation_source: "cached_llm",
        what_happened: ["Clicked &lt;button&gt; Create"],
        likely_friction: ["Repeatedly clicked &lt;button&gt; Submit"],
        narrative: "session_id,sess-1\n--- TIMELINE ---\nelapsed_s,event_type,page,target,detail",
      },
    });

    expect(output).toContain("# Replay sess-1");
    expect(output).toContain("Priority: HIGH");
    expect(output).toContain("## What Happened");
    expect(output).toContain("Clicked <button> Create");
    expect(output).toContain("## Redacted Narrative");
  });

  it("builds GA4 query tool args from flags", () => {
    const args = buildQueryToolArgs("query_ga4", "momofuku-com", [
      "--metrics", "sessions,conversions",
      "--dimensions", "date,sessionDefaultChannelGroup",
      "--start-date", "28daysAgo", "--end-date", "today",
      "--limit", "10", "--order-by", "sessions",
    ]);
    expect(args).toEqual({
      project: "momofuku-com",
      metrics: ["sessions", "conversions"],
      dimensions: ["date", "sessionDefaultChannelGroup"],
      start_date: "28daysAgo",
      end_date: "today",
      limit: 10,
      order_by_metric: "sessions",
    });
  });

  it("maps --limit to row_limit for GSC and defaults to query dimension server-side", () => {
    const args = buildQueryToolArgs("query_gsc", "momofuku-com", ["--dimensions", "query,page", "--limit", "25"]);
    expect(args).toEqual({ project: "momofuku-com", dimensions: ["query", "page"], row_limit: 25 });
  });

  it("documents the hosted analytics setup command", () => {
    const usage = mimUsage();
    expect(usage).toContain("setup-analytics");
    expect(usage).toContain("setup-analytics --status");
  });

  it("parses setup-analytics flags and rejects contradictions", () => {
    expect(parseSetupAnalyticsArgs([])).toEqual({ status: false, wait: false, channel: "" });
    expect(parseSetupAnalyticsArgs(["--status"])).toEqual({ status: true, wait: false, channel: "" });
    expect(parseSetupAnalyticsArgs(["--wait"])).toEqual({ status: false, wait: true, channel: "" });
    expect(parseSetupAnalyticsArgs(["--channel", "agent"])).toEqual({ status: false, wait: false, channel: "agent" });
    expect(() => parseSetupAnalyticsArgs(["--channel", "fax"])).toThrow("--channel must be auto or agent");
    expect(() => parseSetupAnalyticsArgs(["--status", "--channel", "agent"])).toThrow("--channel only applies");
    expect(() => parseSetupAnalyticsArgs(["--status", "--wait"])).toThrow("cannot be combined");
    expect(() => parseSetupAnalyticsArgs(["--bogus"])).toThrow("unknown setup-analytics option");
  });

  it("renders the agent-install snippet in setup output", () => {
    const out = formatAnalyticsSetupPayload({
      status: "done",
      measurement_id: "G-AGENT1234",
      agent_install: {
        snippet: "<meta name=\"google-site-verification\" content=\"tok\" />",
        next: "Apply the snippet, deploy, then poll analytics_setup_status.",
      },
    });
    expect(out).toContain("shared <head>");
    expect(out).toContain("google-site-verification");
    expect(out).toContain("poll analytics_setup_status");
  });

  it("formats hosted analytics setup states for shell output", () => {
    const started = formatAnalyticsSetupPayload({ status: "started", message: "Setup is running." });
    expect(started).toContain("Analytics setup: started");
    expect(started).toContain("Setup is running.");

    const done = formatAnalyticsSetupPayload({
      status: "done",
      measurement_id: "G-ABC123",
      review_url: "https://github.com/o/r/pull/5",
      gsc_verified: false,
      gsc_identity: "merchant",
      updated_at: "2026-07-09T00:00:00",
    });
    expect(done).toContain("Analytics setup: done");
    expect(done).toContain("GA4 measurement ID: G-ABC123");
    expect(done).toContain("Install PR: https://github.com/o/r/pull/5");
    expect(done).toContain("Search Console verified: not yet");
    expect(done).toContain("Search Console identity: merchant");

    expect(formatAnalyticsSetupPayload({})).toContain("Analytics setup: unknown");
  });

  it("parses ads subcommands and scopes --gaql to query", () => {
    expect(parseAdsArgs([])).toEqual({ subcommand: "status", gaql: "", limit: null });
    expect(parseAdsArgs(["setup"])).toEqual({ subcommand: "setup", gaql: "", limit: null });
    expect(parseAdsArgs(["query", "--gaql", "SELECT campaign.name FROM campaign", "--limit", "5"]))
      .toEqual({ subcommand: "query", gaql: "SELECT campaign.name FROM campaign", limit: 5 });
    expect(() => parseAdsArgs(["status", "--gaql", "SELECT 1"])).toThrow("--gaql only applies to ads query");
    expect(() => parseAdsArgs(["bogus"])).toThrow("unknown ads command");
    expect(() => parseAdsArgs(["query", "--limit", "0"])).toThrow("positive integer");
  });

  it("parses klaviyo subcommands and validates resources", () => {
    expect(parseKlaviyoArgs([])).toEqual({ subcommand: "query", resource: "", filter: "", timeframe: "", noOpen: false });
    expect(parseKlaviyoArgs(["query", "--resource", "flows", "--filter", "equals(status,'live')"]))
      .toEqual({ subcommand: "query", resource: "flows", filter: "equals(status,'live')", timeframe: "", noOpen: false });
    expect(parseKlaviyoArgs(["query", "--resource", "abandoned_cart_status"]).resource).toBe("abandoned_cart_status");
    expect(parseKlaviyoArgs(["query", "--resource", "campaign_performance", "--timeframe", "last_90_days"]).timeframe).toBe("last_90_days");
    expect(parseKlaviyoArgs(["connect", "--no-open"]).noOpen).toBe(true);
    expect(() => parseKlaviyoArgs(["query", "--resource", "profiles"])).toThrow("--resource must be one of");
    expect(() => parseKlaviyoArgs(["connect", "--resource", "flows"])).toThrow("only apply to klaviyo query");
    expect(() => parseKlaviyoArgs(["bogus"])).toThrow("unknown klaviyo command");
  });

  it("parses posthog subcommands and scopes flags", () => {
    expect(parsePostHogArgs([])).toEqual({ subcommand: "query", hogql: "", posthogProject: "", limit: null, noOpen: false });
    expect(parsePostHogArgs(["connect", "--no-open"])).toEqual({ subcommand: "connect", hogql: "", posthogProject: "", limit: null, noOpen: true });
    expect(parsePostHogArgs(["query", "--hogql", "SELECT count() FROM events", "--limit", "10"]))
      .toEqual({ subcommand: "query", hogql: "SELECT count() FROM events", posthogProject: "", limit: 10, noOpen: false });
    expect(() => parsePostHogArgs(["connect", "--hogql", "SELECT 1"])).toThrow("only apply to posthog query");
    expect(() => parsePostHogArgs(["query", "--no-open"])).toThrow("--no-open only applies");
    expect(() => parsePostHogArgs(["bogus"])).toThrow("unknown posthog command");
  });

  it("formats ads status for shell output", () => {
    const linked = formatAdsStatusPayload({
      connected: true,
      customer_id: "1234567890",
      account: { name: "Dubbah (Mimetic)", currency: "USD" },
      credential_source: "manager",
      last_event: { event: "ads_account_created", at: "2026-07-09T00:00:00" },
    });
    expect(linked).toContain("Google Ads: linked");
    expect(linked).toContain("Customer ID: 1234567890");
    expect(linked).toContain("Dubbah (Mimetic) (USD)");
    expect(linked).toContain("ads_account_created");

    const unlinked = formatAdsStatusPayload({
      connected: false,
      connect_url: "https://trymimetic.com/site-report/abc",
      message: "No Google Ads account is linked to this project yet.",
    });
    expect(unlinked).toContain("Google Ads: not linked");
    expect(unlinked).toContain("https://trymimetic.com/site-report/abc");
  });

  it("requires --metrics for query-ga4 and rejects unknown options / bad limits", () => {
    expect(() => buildQueryToolArgs("query_ga4", "x", [])).toThrow("requires --metrics");
    expect(() => buildQueryToolArgs("query_ga4", "x", ["--metrics", "sessions", "--bogus", "1"])).toThrow("unknown");
    expect(() => buildQueryToolArgs("query_ga4", "x", ["--metrics", "sessions", "--limit", "abc"])).toThrow("positive integer");
  });
});
