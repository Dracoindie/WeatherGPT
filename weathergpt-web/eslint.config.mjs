import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // the Playwright build (npm run build:e2e)
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre worker copied from node_modules (scripts/copy-maplibre-worker.mjs)
    "public/vendor/**",
    // Playwright output: an interrupted run leaves minified trace resources here
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
