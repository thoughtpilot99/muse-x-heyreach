import type { NextConfig } from "next";

// Local single-user app backed by SQLite: every page reads live data at
// request time, so Cache Components / partial prefetching are left off.
const nextConfig: NextConfig = {
  experimental: {
    // Lead CSV uploads go through a Server Action.
    serverActions: { bodySizeLimit: "5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
