#!/usr/bin/env node
import { mimMain } from "./mim-cli";

mimMain().catch((error: unknown) => {
  console.error(`mim: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
