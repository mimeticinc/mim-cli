import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAuth } from "../src/commands/auth";
import { loadMimConfig, mimConfigPath, saveMimConfig } from "../src/config";

describe.sequential("mim auth credential lifecycle", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mim-auth-test-"));
    vi.stubEnv("MIM_CONFIG_DIR", root);
    vi.stubEnv("MIM_API_BASE_URL", "https://trymimetic.com");
    vi.stubEnv("MIM_API_TOKEN", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("revokes the saved managed token before deleting local credentials", async () => {
    saveMimConfig({ accessToken: "mim_saved_token" });
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ revoked: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await runAuth(["logout"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://trymimetic.com/api/mim/cli/revoke");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer mim_saved_token",
      "content-type": "application/json",
    });
    expect(fetchMock.mock.calls[0][1]?.body).toBe("{}");
    expect(existsSync(mimConfigPath())).toBe(false);
  });

  it("keeps local credentials when revocation cannot be confirmed", async () => {
    saveMimConfig({ accessToken: "mim_saved_token" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(runAuth(["logout"])).rejects.toThrow(
      "local credentials were kept",
    );

    expect(existsSync(mimConfigPath())).toBe(true);
  });

  it("supports an explicit local-only removal without a network request", async () => {
    saveMimConfig({ accessToken: "mim_saved_token" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await runAuth(["logout", "--local-only"]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(mimConfigPath())).toBe(false);
  });

  it("does not accept bearer tokens as login arguments", async () => {
    await expect(runAuth(["login", "--token", "process-visible-secret"]))
      .rejects.toThrow("unknown auth login option: --token");
  });

  it("reuses a valid stored token instead of starting a new device flow", async () => {
    saveMimConfig({ accessToken: "mim_saved_token", user: { email: "owner@example.com" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ projects: [{ key: "acme-shop", name: "Acme", url: "https://acme.example" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await runAuth(["login"]);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/mim/cli/device"))).toBe(false);
    expect(log.mock.calls.flat().join("\n")).toContain("Already logged in as owner@example.com");
  });

  it("starts a fresh device flow when the stored token is rejected", async () => {
    vi.useFakeTimers();
    saveMimConfig({ accessToken: "mim_dead_token", user: { email: "owner@example.com" } });
    let projectsCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/projects")) {
        projectsCalls += 1;
        if (projectsCalls === 1) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        return new Response(JSON.stringify({ projects: [{ key: "acme-shop" }] }), { status: 200 });
      }
      if (url.endsWith("/api/mim/cli/device")) {
        return new Response(JSON.stringify({
          device_code: "device-code",
          verification_uri: "https://trymimetic.com/mim/cli/verify",
          interval: 1,
          expires_in: 60,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: "mim_fresh_token",
        user: { email: "owner@example.com" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = runAuth(["login", "--no-open"]);
    await vi.runAllTimersAsync();
    await login;

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/mim/cli/device"))).toBe(true);
    expect(loadMimConfig().accessToken).toBe("mim_fresh_token");
  });

  it("sets the only project as the default after login", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/cli/device")) {
        return new Response(JSON.stringify({
          device_code: "device-code",
          verification_uri: "https://trymimetic.com/mim/cli/verify",
          interval: 1,
          expires_in: 60,
        }), { status: 200 });
      }
      if (url.endsWith("/api/mim/projects")) {
        return new Response(JSON.stringify({ projects: [{ key: "laso-finance-ca99a2382b" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: "mim_token",
        user: { email: "hunter.monk@gmail.com" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = runAuth(["login", "--no-open"]);
    await vi.runAllTimersAsync();
    await login;

    expect(loadMimConfig().defaultProject).toBe("laso-finance-ca99a2382b");
  });

  it("explains the multi-email trap when the account owns no projects", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/cli/device")) {
        return new Response(JSON.stringify({
          device_code: "device-code",
          verification_uri: "https://trymimetic.com/mim/cli/verify",
          interval: 1,
          expires_in: 60,
        }), { status: 200 });
      }
      if (url.endsWith("/api/mim/projects")) {
        return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: "mim_token",
        user: { email: "hunter.monk@gmail.com" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = runAuth(["login", "--no-open"]);
    await vi.runAllTimersAsync();
    await login;

    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("No projects are linked to hunter.monk@gmail.com");
    expect(output).toContain("mim auth login --force");
  });

  it("verifies the token with the server in auth status and reports a rejection", async () => {
    saveMimConfig({ accessToken: "mim_dead_token", user: { email: "owner@example.com" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));

    await expect(runAuth(["status"])).rejects.toThrow("rejected");
  });

  it("supports device login on a headless server without opening a browser", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/mim/cli/device")) {
        return new Response(JSON.stringify({
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://trymimetic.com/mim/cli/verify",
          interval: 1,
          expires_in: 60,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/mim/projects")) {
        return new Response(JSON.stringify({ projects: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        access_token: "mim_headless_token",
        expires_at: "2026-10-16T00:00:00Z",
        user: { email: "owner@example.com" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = runAuth(["login", "--no-open"]);
    await vi.runAllTimersAsync();
    await login;

    // device start, token poll, and the post-login account verification call
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/api/mim/projects");
    expect(existsSync(mimConfigPath())).toBe(true);
  });
});
