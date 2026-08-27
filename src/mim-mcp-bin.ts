#!/usr/bin/env node
// Invoke unconditionally. An earlier bin pointed directly at mim-mcp-stdio.js
// and relied on an `import.meta.url === pathToFileURL(process.argv[1])` guard
// to start the server. That guard fails whenever the bin is reached through a
// symlink (Homebrew's bin shim, npx's shim) because Node resolves
// import.meta.url to the realpath while process.argv[1] stays the symlink
// path, so the server never started and MCP clients saw "failed to connect".
// The dynamic import keeps the Node version check ahead of any modern syntax.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  process.stderr.write(
    `mim-mcp needs Node.js 20 or newer; this shell is running Node ${process.versions.node}.\n`
    + "Upgrade at https://nodejs.org, or with a version manager: nvm install 20 && nvm use 20\n",
  );
  process.exit(1);
}

import("./mim-mcp-stdio")
  .then(({ runMimMcpStdio }) => runMimMcpStdio())
  .catch((error: unknown) => {
    process.stderr.write(`mim-mcp: ${error instanceof Error ? error.message : "startup failed"}\n`);
    process.exit(1);
  });

// Marks this file as a module so the top-level const stays file-scoped.
export {};
