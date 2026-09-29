import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (apps/dashboard/Dockerfile).
  output: "standalone",
  // npm workspaces hoist dependencies to the repo root, trace from there.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
