import path from "node:path";
import type { NextConfig } from "next";

// The app lives in a subfolder of the repo. Pin both roots to it so `next build`
// here and on Vercel (Root Directory = weathergpt-web) never treat the repo root
// (or a stray lockfile above it) as the workspace.
const appRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  // `npm run build:e2e` builds for Playwright into `.next-e2e` (scripts/e2e-env.mjs),
  // so a test build never replaces the real one. Unset everywhere else.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: appRoot,
  turbopack: { root: appRoot },
};

export default nextConfig;
