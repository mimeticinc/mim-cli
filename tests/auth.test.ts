import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAuth } from "../src/commands/auth";
import { mimConfigPath, saveMimConfig } from "../src/config";

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
});
