import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output = self-contained server bundle for the Docker image
  output: "standalone",
};

export default nextConfig;
