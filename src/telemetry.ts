import { MIM_CLIENT_VERSION } from "./config";
import { MimRuntime } from "./runtime";

type MimUsageEvent = {
  event: string;
  trace_id: string;
  client: "mim-cli" | "mim-mcp";
  client_version: string;
  project?: string;
  command?: string;
  tool?: string;
  status?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
};

const FALSY = ["0", "false", "no", "off"];

// Opt-outs, in the order the Stripe CLI checks them: our own variables plus
// DO_NOT_TRACK, the cross-tool convention corporate images tend to set.
export function shouldSendMimTelemetry(env: NodeJS.ProcessEnv = process.env): boolean {
  const disabled = env.MIM_DISABLE_TELEMETRY?.trim().toLowerCase();
  if (disabled && !FALSY.includes(disabled)) return false;
  const dnt = env.DO_NOT_TRACK?.trim().toLowerCase();
  if (dnt && !FALSY.includes(dnt)) return false;
  const value = env.MIM_TELEMETRY?.trim().toLowerCase();
  return value == null || !FALSY.includes(value);
}

// Which AI agent ran the command, from the environment variables the agents
// themselves set. Same detection order as the Stripe CLI (pkg/useragent).
export function detectAiAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const has = (name: string) => Boolean(env[name]);
  if (has("ANTIGRAVITY_CLI_ALIAS")) return "antigravity";
  if (has("CLAUDECODE") || has("CLAUDE_CODE_ENTRYPOINT")) return "claude_code";
  if (has("CLINE_ACTIVE")) return "cline";
  if (has("CODEX_SANDBOX") || has("CODEX_THREAD_ID") || has("CODEX_SANDBOX_NETWORK_DISABLED") || has("CODEX_CI")
    || has("CODEX_INTERNAL_ORIGINATOR_OVERRIDE")) return "codex_cli";
  if (has("CURSOR_AGENT")) return "cursor";
  if (has("GEMINI_CLI")) return "gemini_cli";
  if (has("HERMES_AGENT")) return "hermes";
  if (has("GROK_AGENT") || has("GROK_SESSION_ID")) return "grok";
  if (has("OPENCODE")) return "open_code";
  if (has("OPENCLAW_SHELL")) return "openclaw";
  if (has("KIRO_SESSION_ID")) return "kiro";
  // AI_AGENT / AGENT: the self-report convention (Goose, Amp, Bun use AGENT).
  const self = (env.AI_AGENT || env.AGENT || "").trim();
  return self ? self.slice(0, 40) : undefined;
}

export function detectTerminalProgram(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.LC_TERMINAL) return env.LC_TERMINAL.slice(0, 40);
  if (env.WARP_CLIENT_VERSION) return "warp";
  if (env.WT_SESSION) return "windows_terminal";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_LOG) return "alacritty";
  if (env.WEZTERM_EXECUTABLE || env.WEZTERM_PANE) return "wezterm";
  if (env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  return env.TERM_PROGRAM ? env.TERM_PROGRAM.slice(0, 40) : undefined;
}

// A bounded outcome instead of the error text, as Stripe sends: a category a
// dashboard can group by, with no URL, path or message that could carry data.
// The server records its own side of every failure with the real error type.
export function httpOutcome(status?: number, error?: unknown): string {
  if (typeof status === "number") {
    if (status < 300) return "ok";
    if (status === 401 || status === 403) return "auth";
    if (status === 402) return "payment_required";
    if (status === 404) return "not_found";
    if (status === 429) return "rate_limited";
    if (status < 500) return "client_error";
    return "server_error";
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (name === "TypeError") return "network";
  return "error";
}

export function sanitizeMimMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMimMetadata(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      const normalized = key.toLowerCase();
      // Error codes and reasons are short identifiers, kept. Free-text
      // error messages are no longer sent at all (see errorTelemetryMetadata).
      if (/^error_(code|reason)$/.test(normalized)) {
        result[key] = sanitizeMimMetadata(item, depth + 1);
      } else if (/(token|secret|authorization|password|credential|cookie|session|narrative|prompt|message|content|raw|body)/.test(normalized)) {
        result[key] = "[redacted]";
      } else {
        result[key] = sanitizeMimMetadata(item, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

export function buildMimUsageEvent(input: Omit<MimUsageEvent, "client_version">,
  env: NodeJS.ProcessEnv = process.env): MimUsageEvent {
  const context: Record<string, unknown> = {};
  const agent = detectAiAgent(env);
  const terminal = detectTerminalProgram(env);
  if (agent) context.ai_agent = agent;
  if (terminal) context.terminal_program = terminal;
  context.os = process.platform;
  context.arch = process.arch;
  const metadata = { ...(input.metadata || {}), ...context };
  return {
    ...input,
    client_version: MIM_CLIENT_VERSION,
    metadata: sanitizeMimMetadata(metadata) as Record<string, unknown>,
  };
}

export async function trackMimUsageEvent(
  runtime: Pick<MimRuntime, "apiBaseUrl" | "token" | "traceId">,
  event: Omit<MimUsageEvent, "client_version" | "trace_id"> & { trace_id?: string },
  fetchImpl = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!shouldSendMimTelemetry(env)) return;
  const payload = buildMimUsageEvent({
    ...event,
    trace_id: event.trace_id || runtime.traceId,
  }, env);
  try {
    await fetchImpl(`${runtime.apiBaseUrl}/api/mim/usage-events`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...(runtime.token ? { authorization: `Bearer ${runtime.token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Telemetry must never break the user workflow.
  }
}

function errorTelemetryMetadata(error: unknown): Record<string, unknown> {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/\bfailed with (\d{3})\b/);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  // No error text: it can carry URLs, paths or project names. The server logs
  // the real error type for every API and MCP failure on its side.
  return {
    error_name: name.slice(0, 40),
    error_status: status,
    http_outcome: httpOutcome(status, error),
  };
}

export async function runTrackedMimCommand<T>(
  runtime: MimRuntime,
  details: {
    command: string;
    project?: string;
    metadata?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await trackMimUsageEvent(runtime, {
      event: "cli_command",
      client: "mim-cli",
      command: details.command,
      project: details.project,
      status: "success",
      duration_ms: Date.now() - started,
      metadata: details.metadata,
    });
    return result;
  } catch (error) {
    await trackMimUsageEvent(runtime, {
      event: "cli_command",
      client: "mim-cli",
      command: details.command,
      project: details.project,
      status: "failure",
      duration_ms: Date.now() - started,
      metadata: {
        ...(details.metadata || {}),
        ...errorTelemetryMetadata(error),
      },
    });
    throw error;
  }
}
