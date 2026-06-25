import type { NextConfig } from "next";

/**
 * Next.js config. `transpilePackages` lets the app consume the shared-schemas
 * workspace package directly. `reactStrictMode` keeps the UI honest.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@repo/shared-schemas"],
  eslint: {
    // Linting is advisory in this repo and runs separately; never block builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
