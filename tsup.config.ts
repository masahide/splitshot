import { defineConfig } from "tsup";

export default defineConfig({
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: true,
    minify: false,
    banner: { js: "#!/usr/bin/env node" } // shebang 付与
});
