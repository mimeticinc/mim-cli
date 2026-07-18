import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import packageJson from "../package.json";
import { homeDir } from "./util";

export const DEFAULT_MIM_API_BASE_URL = "https://trymimetic.com";
export const MIM_CLIENT_VERSION = packageJson.version;

export type MimConfig = {
  apiBaseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  defaultProject?: string;
  user?: {
    id?: string;
    email?: string;
  };
};

export function mimConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MIM_CONFIG_DIR?.trim();
  if (configured) return configured;
  const home = homeDir(env);
  if (!home) throw new Error("MIM_CONFIG_DIR or HOME is required to store Mimetic credentials");
  return join(home, ".mim");
}

export function mimConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(mimConfigDir(env), "config.json");
}

export function loadMimConfig(env: NodeJS.ProcessEnv = process.env): MimConfig {
  let path = "";
  try {
    path = mimConfigPath(env);
  } catch {
    return {};
  }
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MimConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMimConfig(config: MimConfig, env: NodeJS.ProcessEnv = process.env): void {
  const dir = mimConfigDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = mimConfigPath(env);
  if (process.platform !== "win32") {
    chmodSync(dir, 0o700);
    if (existsSync(path)) chmodSync(path, 0o600);
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

export function clearMimConfig(env: NodeJS.ProcessEnv = process.env): void {
  const path = mimConfigPath(env);
  if (existsSync(path)) rmSync(path);
}

function allowsInsecureHttp(env: NodeJS.ProcessEnv): boolean {
  const value = env.MIM_ALLOW_INSECURE_HTTP?.trim().toLowerCase();
  return Boolean(value && ["1", "true", "yes", "on"].includes(value));
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "::1"
    || normalized === "[::1]"
    || normalized.startsWith("127.")
  );
}

export function normalizeMimApiBaseUrl(
  value: string | undefined,
  source = "MIM_API_BASE_URL",
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (value || DEFAULT_MIM_API_BASE_URL).trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${source} must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${source} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${source} must not include URL credentials`);
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname) && !allowsInsecureHttp(env)) {
    throw new Error(
      `${source} must use https; plain http is allowed only for loopback development `
      + "(set MIM_ALLOW_INSECURE_HTTP=1 to override)",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

export function mimApiBaseUrl(config: MimConfig = {}, env: NodeJS.ProcessEnv = process.env): string {
  return normalizeMimApiBaseUrl(
    env.MIM_API_BASE_URL || config.apiBaseUrl || DEFAULT_MIM_API_BASE_URL,
    "MIM_API_BASE_URL",
    env,
  );
}

export function mimAuthToken(config: MimConfig = {}, env: NodeJS.ProcessEnv = process.env): string {
  return env.MIM_API_TOKEN?.trim() || config.accessToken?.trim() || "";
}

export function defaultMimProject(config: MimConfig = {}, env: NodeJS.ProcessEnv = process.env): string {
  return env.MIM_PROJECT?.trim() || config.defaultProject?.trim() || "";
}
