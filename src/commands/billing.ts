import { BillingStatusResponse, formatBillingStatus, parseFormat, printJson } from "../format";
import { mimRequest, projectPath, requireAuth, requireProject, runtimeFromArgs } from "../runtime";
import { runTrackedMimCommand } from "../telemetry";
import { openBrowser } from "../util";

type BillingCheckoutResponse = {
  checkout_url?: string;
};

export async function runBilling(args: string[]): Promise<void> {
  const [subcommand = "status", ...rest] = args;
  const { runtime, args: kept, project } = runtimeFromArgs(rest);
  requireAuth(runtime);
  const resolvedProject = requireProject(project);

  if (subcommand === "status") {
    const parsedFormat = parseFormat(kept, "markdown");
    if (parsedFormat.args.length) throw new Error(`unknown billing status option: ${parsedFormat.args[0]}`);
    const payload = await runTrackedMimCommand(
      runtime,
      { command: "billing status", project: resolvedProject, metadata: { format: parsedFormat.format } },
      () => mimRequest<BillingStatusResponse>(runtime, projectPath("/api/mim/projects/:project/billing", resolvedProject)),
    );
    if (parsedFormat.format === "json") printJson(payload);
    else console.log(formatBillingStatus(payload));
    return;
  }

  if (subcommand === "checkout" || subcommand === "open") {
    const parsedFormat = parseFormat(kept, "markdown");
    const [plan = "starter", ...unknown] = parsedFormat.args;
    if (unknown.length) throw new Error(`unknown billing ${subcommand} option: ${unknown[0]}`);
    const payload = await runTrackedMimCommand(
      runtime,
      { command: `billing ${subcommand}`, project: resolvedProject, metadata: { plan, format: parsedFormat.format } },
      () => mimRequest<BillingCheckoutResponse>(
        runtime,
        projectPath("/api/mim/projects/:project/billing/checkout", resolvedProject),
        { method: "POST", body: { plan } },
      ),
    );
    if (!payload.checkout_url) throw new Error("checkout URL was not returned");
    if (subcommand === "open") openBrowser(payload.checkout_url);
    if (parsedFormat.format === "json") printJson(payload);
    else console.log(payload.checkout_url);
    return;
  }

  if (subcommand === "portal") {
    const parsedFormat = parseFormat(kept, "markdown");
    if (parsedFormat.args.length) throw new Error(`unknown billing portal option: ${parsedFormat.args[0]}`);
    const payload = await runTrackedMimCommand(
      runtime,
      { command: "billing portal", project: resolvedProject, metadata: { format: parsedFormat.format } },
      () => mimRequest<BillingStatusResponse>(runtime, projectPath("/api/mim/projects/:project/billing", resolvedProject)),
    );
    const portalUrl = payload.billing?.portal_url;
    if (!portalUrl) throw new Error("billing portal is not available yet; run `mim billing checkout` first");
    openBrowser(portalUrl);
    if (parsedFormat.format === "json") printJson({ portal_url: portalUrl });
    else console.log(portalUrl);
    return;
  }

  throw new Error(`unknown billing command: ${subcommand}`);
}
