import { MIM_CLIENT_VERSION, MimConfig, clearMimConfig, defaultMimProject, saveMimConfig } from "../config";
import { MimRuntime, mimRequest, runtimeFromArgs } from "../runtime";
import { openBrowser } from "../util";
import {
  MimProjectSummary,
  checkMimAccount,
  describeTokenSource,
  ensureDefaultProject,
  fetchMimProjects,
  noProjectsGuidance,
  summarizeProjects,
} from "../account";

type DeviceStartResponse = {
  device_code?: string;
  deviceCode?: string;
  user_code?: string;
  userCode?: string;
  verification_uri?: string;
  verificationUri?: string;
  verification_uri_complete?: string;
  verificationUriComplete?: string;
  expires_in?: number;
  expiresIn?: number;
  interval?: number;
};

type TokenResponse = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_at?: string;
  expiresAt?: string;
  default_project?: string;
  defaultProject?: string;
  user?: MimConfig["user"];
  projects?: unknown[];
};

export type LoginResult = {
  runtime: MimRuntime;
  email: string;
  projects: MimProjectSummary[];
  reused: boolean;
  defaultProject: string;
};

export type LoginOptions = {
  noOpen?: boolean;
  force?: boolean;
  log?: (line: string) => void;
};

async function pollDeviceToken(runtime: MimRuntime, deviceCode: string, intervalSec: number, expiresInSec: number): Promise<TokenResponse> {
  const deadline = Date.now() + expiresInSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, intervalSec) * 1000));
    try {
      return await mimRequest<TokenResponse>(runtime, "/api/mim/cli/token", {
        method: "POST",
        body: { device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("428") || message.includes("authorization_pending") || message.includes("slow_down")) continue;
      throw error;
    }
  }
  throw new Error("login timed out; run `mim auth login` again");
}

// Signs the machine in, reusing an existing working token unless forced.
// Reuse matters: a user who retries login because something else failed should
// not mint a fresh server-side token on every attempt. Every path here ends
// with a real API call, so a "logged in" result means the token actually works.
export async function ensureLoggedIn(runtime: MimRuntime, options: LoginOptions = {}): Promise<LoginResult> {
  const log = options.log || ((line: string) => console.log(line));

  if (runtime.token && !options.force) {
    const check = await checkMimAccount(runtime);
    if (check.valid) {
      const email = runtime.config.user?.email || "";
      const defaultProject = ensureDefaultProject(runtime.config, check.projects) || defaultMimProject(runtime.config);
      return { runtime, email, projects: check.projects, reused: true, defaultProject };
    }
    log("The stored token was rejected by the server (expired or revoked). Starting a fresh login.");
  }

  const started = await mimRequest<DeviceStartResponse>(runtime, "/api/mim/cli/device", {
    method: "POST",
    body: { client: "mim-cli", version: MIM_CLIENT_VERSION },
  });
  const deviceCode = started.device_code || started.deviceCode || "";
  const userCode = started.user_code || started.userCode || "";
  const verificationUri = started.verification_uri_complete || started.verificationUriComplete || started.verification_uri || started.verificationUri || "";
  if (!deviceCode || !verificationUri) throw new Error("TryMimetic did not return a device login URL");

  log("Open this URL to finish Mimetic login:");
  log(`  ${verificationUri}`);
  if (userCode) log(`Code: ${userCode}`);
  if (!options.noOpen) openBrowser(verificationUri);

  const tokenResponse = await pollDeviceToken(runtime, deviceCode, started.interval || 3, started.expires_in || started.expiresIn || 600);
  const accessToken = tokenResponse.access_token || tokenResponse.accessToken || "";
  if (!accessToken) throw new Error("TryMimetic did not return an access token");
  const nextConfig: MimConfig = {
    ...runtime.config,
    apiBaseUrl: runtime.apiBaseUrl,
    accessToken,
    refreshToken: tokenResponse.refresh_token || tokenResponse.refreshToken,
    expiresAt: tokenResponse.expires_at || tokenResponse.expiresAt,
    defaultProject: tokenResponse.default_project || tokenResponse.defaultProject || runtime.config.defaultProject,
    user: tokenResponse.user || runtime.config.user,
  };
  saveMimConfig(nextConfig);
  const nextRuntime: MimRuntime = { ...runtime, token: accessToken, config: nextConfig };

  if (process.env.MIM_API_TOKEN?.trim() && process.env.MIM_API_TOKEN.trim() !== accessToken) {
    log("Warning: MIM_API_TOKEN is set and overrides this login for every mim command. Unset it to use the new credentials.");
  }

  let projects: MimProjectSummary[];
  try {
    projects = await fetchMimProjects(nextRuntime);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`login succeeded but verifying the account failed: ${detail}. Run \`mim auth status\` to retry the check`);
  }
  const defaultProject = ensureDefaultProject(nextConfig, projects);
  return { runtime: nextRuntime, email: nextConfig.user?.email || "", projects, reused: false, defaultProject };
}

export function reportLoginResult(result: LoginResult, log: (line: string) => void = console.log): void {
  const who = result.email || "(token configured)";
  if (result.reused) {
    log(`Already logged in as ${who}. Run \`mim auth login --force\` to switch accounts.`);
  } else {
    log(`Logged in as ${who}.`);
  }
  if (result.projects.length > 0) {
    const plural = result.projects.length === 1 ? "project" : "projects";
    log(`${result.projects.length} ${plural}: ${summarizeProjects(result.projects)}`);
    if (result.defaultProject) log(`Default project: ${result.defaultProject}`);
  } else {
    for (const line of noProjectsGuidance(result.email)) log(line);
  }
}

export async function runAuth(args: string[]): Promise<void> {
  const [subcommand = "status", ...rest] = args;
  const { runtime, args: kept } = runtimeFromArgs(rest);

  if (subcommand === "logout") {
    let localOnly = false;
    for (const arg of kept) {
      if (arg === "--local-only") localOnly = true;
      else throw new Error(`unknown auth logout option: ${arg}`);
    }

    const savedToken = runtime.config.accessToken?.trim() || "";
    if (savedToken && !localOnly) {
      try {
        await mimRequest(
          { ...runtime, token: savedToken },
          "/api/mim/cli/revoke",
          { method: "POST", body: {} },
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `could not revoke the stored Mimetic token, so local credentials were kept: ${detail}. `
          + "Retry, or use `mim auth logout --local-only` to remove only this machine's copy",
        );
      }
    }
    clearMimConfig();
    if (savedToken && !localOnly) {
      console.log("Revoked the stored Mimetic token and removed local credentials.");
    } else if (savedToken) {
      console.log("Removed local credentials without revoking the stored Mimetic token.");
    } else {
      console.log("No stored Mimetic token was found; local credentials were cleared.");
    }
    if (process.env.MIM_API_TOKEN) {
      console.log("MIM_API_TOKEN is still set in the environment and was not changed.");
    }
    return;
  }

  if (subcommand === "status") {
    if (kept.length) throw new Error(`unknown auth status option: ${kept[0]}`);
    if (!runtime.token) {
      console.log("Not authenticated. Run `mim setup` to get started, or `mim auth login`.");
      return;
    }
    const email = runtime.config.user?.email || "(token configured)";
    const project = defaultMimProject(runtime.config) || "(none)";
    let check;
    try {
      check = await checkMimAccount(runtime);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`Authenticated as ${email} (token from ${describeTokenSource()}, not verified)`);
      console.log(`API: ${runtime.apiBaseUrl}`);
      console.log(`Default project: ${project}`);
      console.log(`Could not verify the token with the server: ${detail}`);
      return;
    }
    if (!check.valid) {
      const expiresAt = runtime.config.expiresAt?.trim();
      const expiry = expiresAt && Date.parse(expiresAt) < Date.now() ? ` It expired on ${expiresAt}.` : "";
      throw new Error(`the token for ${email} was rejected by ${runtime.apiBaseUrl} (expired or revoked).${expiry} Run \`mim auth login\` to sign in again`);
    }
    console.log(`Authenticated as ${email} (token from ${describeTokenSource()}, verified with the server)`);
    console.log(`API: ${runtime.apiBaseUrl}`);
    console.log(`Default project: ${project}`);
    if (check.projects.length > 0) {
      const plural = check.projects.length === 1 ? "project" : "projects";
      console.log(`${check.projects.length} ${plural}: ${summarizeProjects(check.projects)}`);
    } else {
      for (const line of noProjectsGuidance(runtime.config.user?.email || "")) console.log(line);
    }
    return;
  }

  if (subcommand !== "login") throw new Error(`unknown auth command: ${subcommand}`);

  let noOpen = false;
  let force = false;
  for (const arg of kept) {
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--force") force = true;
    else throw new Error(`unknown auth login option: ${arg}`);
  }

  const result = await ensureLoggedIn(runtime, { noOpen, force });
  reportLoginResult(result);
}
