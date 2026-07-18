#!/usr/bin/env node
import { runMimMcpStdio } from "./mim-mcp-stdio";

// Invoke unconditionally, mirroring mim-bin.ts. The previous bin pointed directly at
// mim-mcp-stdio.js and relied on an `import.meta.url === pathToFileURL(process.argv[1])`
// guard to start the server. That guard fails whenever the bin is reached through a
// symlink (Homebrew's bin shim, npx's shim) because Node resolves import.meta.url to the
// realpath while process.argv[1] stays the symlink path, so the server never started and
// MCP clients saw "failed to connect".
try {
  runMimMcpStdio();
} catch (error) {
  process.stderr.write(`mim-mcp: ${error instanceof Error ? error.message : "startup failed"}\n`);
  process.exit(1);
}
