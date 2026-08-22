import { defineConfig } from "tsup";

// Shebang required so the bin can be executed directly.
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node24",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    // Resolve the tsconfig `#/*` alias for tsup/esbuild.
    options.alias = { "#": "./src" };
  },
});
