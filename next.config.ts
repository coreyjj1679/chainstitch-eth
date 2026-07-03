import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile exists in the home directory; pin the workspace root.
  turbopack: { root: __dirname },
  // Self-contained server bundle for the Docker image (README → Self-hosting).
  output: "standalone",
  // Test harnesses (scripts/team-e2e.ts) run a second dev server in parallel;
  // a separate dist dir keeps it from fighting over .next with the main one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
