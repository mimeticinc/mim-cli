#!/usr/bin/env node
// No static imports here: the Node version check must run before any modern
// syntax from the main bundle gets a chance to crash with a confusing
// SyntaxError on an old runtime.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  process.stderr.write(
    `mim needs Node.js 20 or newer; this shell is running Node ${process.versions.node}.\n`
    + "Upgrade at https://nodejs.org, or with a version manager: nvm install 20 && nvm use 20\n",
  );
  process.exit(1);
}

import("./mim-cli")
  .then(({ mimMain }) => mimMain())
  .catch((error: unknown) => {
    console.error(`mim: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

// Marks this file as a module so the top-level const stays file-scoped.
export {};
