import { AuditResponse, auditId, formatAuditPayload, parseFormat, printJson, sleep } from "../format";
import { MimRuntime, mimRequest, requireAuth, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { readValue } from "../util";

async function pollAuditCompletion(
  runtime: MimRuntime,
  id: string,
  initial: AuditResponse | null,
  format: "json" | "markdown",
  pollIntervalSec: number,
): Promise<AuditResponse> {
  let payload = initial || (await mimRequest<AuditResponse>(runtime, `/api/mim/audits/${encodeURIComponent(id)}/status`));
  while (payload.status === "running" || payload.status === "pending") {
    await sleep(pollIntervalSec * 1000);
    payload = await mimRequest<AuditResponse>(runtime, `/api/mim/audits/${encodeURIComponent(id)}/status`);
    if (format !== "json") {
      const progress = payload.progress == null ? "" : ` ${payload.progress}%`;
      const note = payload.refreshing ? " (refreshing over an older report)" : "";
      process.stderr.write(`audit ${id}: ${payload.status || "unknown"}${progress}${note}\n`);
    }
  }
  return payload;
}

export async function runAudit(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new Error("audit command must be start, rerun, status, or wait");
  const { runtime, args: kept } = runtimeFromArgs(rest);
  requireAuth(runtime);
  const parsedFormat = parseFormat(kept, "markdown");

  if (subcommand === "status" || subcommand === "wait") {
    let id = "";
    let pollIntervalSec = 5;
    for (let i = 0; i < parsedFormat.args.length; i += 1) {
      const arg = parsedFormat.args[i];
      if (arg === "--poll-interval") {
        const [value, next] = readValue(parsedFormat.args, i, arg);
        pollIntervalSec = Number(value);
        i = next;
      } else if (!id) {
        id = arg;
      } else {
        throw new Error(`unknown audit ${subcommand} option: ${arg}`);
      }
    }
    if (!id) throw new Error(`audit ${subcommand} requires an audit_id`);
    if (!Number.isFinite(pollIntervalSec) || pollIntervalSec < 1 || pollIntervalSec > 60) {
      throw new Error("--poll-interval must be a number between 1 and 60");
    }
    const payload = await runTrackedMimCommand(
      runtime,
      { command: `audit ${subcommand}`, metadata: { audit_id: id, format: parsedFormat.format, wait: subcommand === "wait" } },
      async () => {
        const current = await mimRequest<AuditResponse>(runtime, `/api/mim/audits/${encodeURIComponent(id)}/status`);
        return subcommand === "wait" ? pollAuditCompletion(runtime, id, current, parsedFormat.format, pollIntervalSec) : current;
      },
    );
    if (parsedFormat.format === "json") printJson(payload);
    else console.log(formatAuditPayload(payload));
    return;
  }

  if (subcommand !== "start" && subcommand !== "rerun") throw new Error(`unknown audit command: ${subcommand}`);

  let url = "";
  let email = "";
  let mode = "slim";
  let force = subcommand === "rerun";
  let wait = false;
  let pollIntervalSec = 5;
  for (let i = 0; i < parsedFormat.args.length; i += 1) {
    const arg = parsedFormat.args[i];
    if (arg === "--force" || arg === "--reaudit") {
      force = true;
    } else if (arg === "--wait") {
      wait = true;
    } else if (arg === "--email") {
      const [value, next] = readValue(parsedFormat.args, i, arg);
      email = value;
      i = next;
    } else if (arg === "--mode") {
      const [value, next] = readValue(parsedFormat.args, i, arg);
      if (value !== "slim" && value !== "full") throw new Error("--mode must be slim or full");
      mode = value;
      i = next;
    } else if (arg === "--poll-interval") {
      const [value, next] = readValue(parsedFormat.args, i, arg);
      pollIntervalSec = Number(value);
      i = next;
    } else if (!url) {
      url = arg;
    } else {
      throw new Error(`unknown audit ${subcommand} option: ${arg}`);
    }
  }
  if (!url) throw new Error(`audit ${subcommand} requires a URL`);
  if (!Number.isFinite(pollIntervalSec) || pollIntervalSec < 1 || pollIntervalSec > 60) {
    throw new Error("--poll-interval must be a number between 1 and 60");
  }

  const payload = await runTrackedMimCommand(
    runtime,
    { command: subcommand === "rerun" ? "audit rerun" : "audit start", metadata: { force, wait, mode, format: parsedFormat.format } },
    async () => {
      const startedPayload = await mimRequest<AuditResponse>(runtime, "/api/mim/audits", {
        method: "POST",
        body: { url, force, mode, ...(email ? { email } : {}) },
      });
      if (!wait) return startedPayload;
      const id = auditId(startedPayload);
      if (!id) throw new Error("TryMimetic did not return an audit_id");
      return pollAuditCompletion(runtime, id, startedPayload, parsedFormat.format, pollIntervalSec);
    },
  );

  if (parsedFormat.format === "json") printJson(payload);
  else console.log(formatAuditPayload(payload));
}
