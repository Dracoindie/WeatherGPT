import path from "node:path";
import type { NextConfig } from "next";

// The repo root also has a package.json/package-lock.json (leaflet only, left
// from the first commit). Pin both roots to this app so `next build` here and
// on Vercel (Root Directory = weathergpt-web) never treats the repo root as
// the workspace.
const appRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  turbopack: { root: appRoot },
};

export default nextConfig;
