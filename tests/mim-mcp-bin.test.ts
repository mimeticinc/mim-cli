import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, symlinkSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression guard for the bin-startup bug: the mim-mcp bin used to point straight at
// mim-mcp-stdio.js and rely on `import.meta.url === pathToFileURL(process.argv[1])` to
// start the server. Reached through a symlink (Homebrew/npx), that guard is false (Node
// resolves import.meta.url to the realpath while argv[1] stays the symlink), so the
// server never started and MCP clients saw "failed to connect". This test runs the built
// bin THROUGH A SYMLINK and asserts it starts and proxies a response.

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const binPath = join(repo, "dist", "mim-mcp-bin.js");

let stub: Server;
let stubUrl: string;
let symlinkDir: string;
let symlinkPath: string;

beforeAll(async () => {
  if (!existsSync(binPath)) {
    execSync("npm run build", { cwd: repo, stdio: "ignore" });
  }
  // Local stub standing in for the hosted /api/mim/mcp endpoint.
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { tools: [{ name: "query_ga4" }, { name: "query_gsc" }] } }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const addr = stub.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  stubUrl = `http://127.0.0.1:${port}/api/mim/mcp`;
  // Reach the bin through a SYMLINK — the exact condition that used to break startup.
  symlinkDir = mkdtempSync(join(tmpdir(), "mim-mcp-link-"));
  symlinkPath = join(symlinkDir, "mim-mcp");
  symlinkSync(binPath, symlinkPath);
});

afterAll(() => {
  stub?.close();
  if (symlinkDir) rmSync(symlinkDir, { recursive: true, force: true });
});

describe("mim-mcp bin startup", () => {
  it("starts via a symlink and proxies a tools/list response", async () => {
    const child = spawn("node", [symlinkPath], {
      env: { ...process.env, MIM_API_TOKEN: "mim_token", MIM_MCP_URL: stubUrl, MIM_TELEMETRY: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => out.push(c));

    const tools = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response; bin likely exited early. stdout=${out.join("")}`)), 8000);
      child.stdout.on("data", () => {
        for (const line of out.join("").split("\n")) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === 2 && msg.result?.tools) {
              clearTimeout(timer);
              resolve(msg.result.tools.map((t: { name: string }) => t.name));
            }
          } catch {
            /* partial line */
          }
        }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    });

    expect(tools).toContain("query_ga4");
    expect(tools).toContain("query_gsc");
    child.kill();
  });
});
