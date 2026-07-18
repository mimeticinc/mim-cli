import { MIM_CLIENT_VERSION, MimConfig, clearMimConfig, defaultMimProject, saveMimConfig } from "../config";
import { MimRuntime, mimRequest, runtimeFromArgs } from "../runtime";
import { openBrowser } from "../util";

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
    const token = runtime.token;
    if (!token) {
      console.log("Not authenticated. Run `mim auth login`.");
      return;
    }
    const email = runtime.config.user?.email || "(token configured)";
    const project = defaultMimProject(runtime.config) || "(none)";
    console.log(`Authenticated as ${email}`);
    console.log(`API: ${runtime.apiBaseUrl}`);
    console.log(`Default project: ${project}`);
    return;
  }

  if (subcommand !== "login") throw new Error(`unknown auth command: ${subcommand}`);

  let noOpen = false;
  for (const arg of kept) {
    if (arg === "--no-open") {
      noOpen = true;
    } else {
      throw new Error(`unknown auth login option: ${arg}`);
    }
  }

  const started = await mimRequest<DeviceStartResponse>(runtime, "/api/mim/cli/device", {
    method: "POST",
    body: { client: "mim-cli", version: MIM_CLIENT_VERSION },
  });
  const deviceCode = started.device_code || started.deviceCode || "";
  const userCode = started.user_code || started.userCode || "";
  const verificationUri = started.verification_uri_complete || started.verificationUriComplete || started.verification_uri || started.verificationUri || "";
  if (!deviceCode || !verificationUri) throw new Error("TryMimetic did not return a device login URL");

  console.log("Open this URL to finish Mimetic login:");
  console.log(`  ${verificationUri}`);
  if (userCode) console.log(`Code: ${userCode}`);
  if (!noOpen) openBrowser(verificationUri);

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
  console.log(`Logged in${nextConfig.user?.email ? ` as ${nextConfig.user.email}` : ""}.`);
  if (nextConfig.defaultProject) console.log(`Default project: ${nextConfig.defaultProject}`);
}
