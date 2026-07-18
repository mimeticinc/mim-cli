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

export function shouldSendMimTelemetry(env: NodeJS.ProcessEnv = process.env): boolean {
  const disabled = env.MIM_DISABLE_TELEMETRY?.trim().toLowerCase();
  if (disabled && !["0", "false", "no", "off"].includes(disabled)) return false;
  const value = env.MIM_TELEMETRY?.trim().toLowerCase();
  return value == null || !["0", "false", "no", "off"].includes(value);
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
      if (/(token|secret|authorization|password|credential|cookie|session|narrative|prompt|message|content|raw|body)/.test(normalized)) {
        result[key] = "[redacted]";
      } else {
        result[key] = sanitizeMimMetadata(item, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

export function buildMimUsageEvent(input: Omit<MimUsageEvent, "client_version">): MimUsageEvent {
  return {
    ...input,
    client_version: MIM_CLIENT_VERSION,
    metadata: input.metadata ? (sanitizeMimMetadata(input.metadata) as Record<string, unknown>) : undefined,
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
  });
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
  return {
    error_name: name,
    error_status: statusMatch ? Number(statusMatch[1]) : undefined,
    error_message: message.slice(0, 240),
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
