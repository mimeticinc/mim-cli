import { describe, expect, it } from "vitest";

import { buildMimUsageEvent, detectAiAgent, httpOutcome, shouldSendMimTelemetry } from "../src/telemetry";

describe("telemetry matches the Stripe CLI's rules", () => {
  it("honours DO_NOT_TRACK alongside our own opt-outs", () => {
    expect(shouldSendMimTelemetry({})).toBe(true);
    expect(shouldSendMimTelemetry({ DO_NOT_TRACK: "1" })).toBe(false);
    expect(shouldSendMimTelemetry({ DO_NOT_TRACK: "0" })).toBe(true);
    expect(shouldSendMimTelemetry({ MIM_TELEMETRY: "0" })).toBe(false);
    expect(shouldSendMimTelemetry({ MIM_DISABLE_TELEMETRY: "1" })).toBe(false);
  });

  it("detects the AI agent from the variables agents set", () => {
    expect(detectAiAgent({ CLAUDECODE: "1" })).toBe("claude_code");
    expect(detectAiAgent({ CODEX_THREAD_ID: "x" })).toBe("codex_cli");
    expect(detectAiAgent({ CURSOR_AGENT: "1" })).toBe("cursor");
    expect(detectAiAgent({ AGENT: "goose" })).toBe("goose");
    expect(detectAiAgent({})).toBeUndefined();
  });

  it("sends a bounded outcome, never error text", () => {
    expect(httpOutcome(404)).toBe("not_found");
    expect(httpOutcome(429)).toBe("rate_limited");
    expect(httpOutcome(503)).toBe("server_error");
    const event = buildMimUsageEvent({
      event: "cli_command", trace_id: "t", client: "mim-cli", status: "failure",
      metadata: { error_message: "GET https://shop.example/private/path failed", http_outcome: "not_found" },
    }, { CLAUDECODE: "1" });
    expect(JSON.stringify(event)).not.toContain("shop.example");
    expect(event.metadata?.ai_agent).toBe("claude_code");
    expect(event.metadata?.http_outcome).toBe("not_found");
  });
});
