import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
// Scoped import: tsconfig restricts global `types`, so `process` is not a
// global here — pull it from node:process (config runs under Node).
import * as process from "node:process";
import { brandPlugin } from "./scripts/vite-brand-plugin.ts";

// CI caps the vitest worker pool via VITEST_MAX_WORKERS so the jsdom suite does
// not saturate the Gitea runner host (a saturated host stalls the Docker daemon
// and act_runner's post-step container-archive copy then times out). Unset
// locally → vitest default (one worker per CPU). Set in .gitea/workflows/main.yml.
const maxWorkers = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : undefined;

export default defineConfig({
  // brandPlugin: dist/brands/** + dist/brand/ (= neutral), /brand/ served from brands/$BRAND in dev
  // and preview, an unknown BRAND refused at start-up (scripts/vite-brand-plugin.ts).
  plugins: [react(), brandPlugin()],
  // The rest half (cumba-oss-corej-rule-editor-rest) listens on 8081 by default.
  server: { proxy: { "/api": "http://localhost:8081" } },
  build: {
    // Split the heavy, rarely-changing vendor libraries into their own chunks so the app bundle
    // stays well under the 500 kB warning and these large deps cache independently across releases.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@mantine")) return "mantine";
          if (
            id.includes("@codemirror") ||
            id.includes("@lezer") ||
            id.includes("react-codemirror")
          )
            return "codemirror";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    maxWorkers,
    // Give jsdom a real origin so the same-origin relative baseUrl ("/") in
    // the API client resolves to an absolute URL that fetch/MSW can parse.
    // customExportConditions: [""] forces packages (msw, openapi-fetch) to
    // resolve their Node export rather than the browser one, so MSW's
    // setupServer interceptor patches the same fetch the client uses under
    // jsdom (otherwise requests escape to the network). See mswjs/msw docs.
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
      customExportConditions: [""],
    },
    globals: true,
    setupFiles: "src/test/setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Vitest reads thresholds on a 0-100 percentage scale (NOT 0-1 ratios:
      // a fractional value like 0.85 means 0.85% and silently disables the
      // gate). 85/85/70/85 as in cumba-oss-corej-web (PLAN-rule-editor phase 2).
      thresholds: { lines: 85, functions: 85, branches: 70, statements: 85 },
      include: ["src/**"],
      exclude: [
        "src/api/schema.d.ts",
        "src/api/types.ts",
        "src/main.tsx",
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/test/**",
      ],
    },
  },
});
