import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/mim-bin.ts", "src/mim-cli.ts", "src/mim-mcp-stdio.ts", "src/mim-mcp-bin.ts"],
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
});
