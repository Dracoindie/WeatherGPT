import path from "node:path";
import type { NextConfig } from "next";

// The app lives in a subfolder of the repo. Pin both roots to it so `next build`
// here and on Vercel (Root Directory = weathergpt-web) never treat the repo root
// (or a stray lockfile above it) as the workspace.
const appRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  turbopack: { root: appRoot },
};

export default nextConfig;
