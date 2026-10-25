import type { NextConfig } from "next";

const recordedDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "recorded";

const nextConfig: NextConfig = {
  ...(recordedDemo ? { output: "export", trailingSlash: true } : {}),
  cacheComponents: !recordedDemo,
  partialPrefetching: !recordedDemo,
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
