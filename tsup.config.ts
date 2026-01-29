import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  outDir: "dist",
  shims: true,
  splitting: false,
  treeshake: true,
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
