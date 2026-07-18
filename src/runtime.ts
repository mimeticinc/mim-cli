import { randomUUID } from "node:crypto";

import { DEFAULT_MIM_API_BASE_URL, MIM_CLIENT_VERSION, MimConfig, defaultMimProject, loadMimConfig, mimAuthToken, normalizeMimApiBaseUrl } from "./config";
import { readValue } from "./util";

export type MimRuntime = {
  apiBaseUrl: string;
  token: string;
  config: MimConfig;
  traceId: string;
};

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  acceptText?: boolean;
};

export function runtimeFromArgs(args: string[]): { runtime: MimRuntime; args: string[]; project: string } {
  let apiBaseUrlFlag = "";
  let project = "";
  const kept: string[] = [];
  const config = loadMimConfig();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--api-base-url") {
      const [value, next] = readValue(args, i, arg);
      apiBaseUrlFlag = value;
      i = next;
    } else if (arg === "--project") {
      const [value, next] = readValue(args, i, arg);
      project = value;
      i = next;
    } else {
      kept.push(arg);
    }
  }

  const apiBaseUrl = normalizeMimApiBaseUrl(
    apiBaseUrlFlag || process.env.MIM_API_BASE_URL || config.apiBaseUrl || DEFAULT_MIM_API_BASE_URL,
    apiBaseUrlFlag ? "--api-base-url" : "MIM_API_BASE_URL",
    process.env,
  );
  const token = mimAuthToken(config);
  const resolvedProject = project || defaultMimProject(config);
  return {
    runtime: {
      apiBaseUrl,
      token,
      config,
      traceId: randomUUID(),
    },
    args: kept,
    project: resolvedProject,
  };
}

export function requireAuth(runtime: MimRuntime): void {
  if (!runtime.token) {
    throw new Error("not authenticated; run `mim auth login` or set MIM_API_TOKEN");
  }
}

export function requireProject(project: string): string {
  if (!project) throw new Error("--project is required; run `mim projects` or set MIM_PROJECT");
  return project;
}

export function projectPath(path: string, project: string): string {
  return path.replace(":project", encodeURIComponent(project));
}

export async function mimRequest<T>(runtime: MimRuntime, path: string, options: RequestOptions = {}, fetchImpl = fetch): Promise<T> {
  const response = await fetchImpl(`${runtime.apiBaseUrl}${path}`, {
    method: options.method || (options.body == null ? "GET" : "POST"),
    redirect: "error",
    headers: {
      accept: options.acceptText ? "text/plain, application/json" : "application/json",
      ...(options.body == null ? {} : { "content-type": "application/json" }),
      ...(runtime.token ? { authorization: `Bearer ${runtime.token}` } : {}),
      "x-mim-client": "mim-cli",
      "x-mim-client-version": MIM_CLIENT_VERSION,
      "x-mim-trace-id": runtime.traceId,
      ...(options.headers || {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${path} failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (options.acceptText) return (await response.text()) as T;
  return (await response.json()) as T;
}
