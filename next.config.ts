import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: '/app',
  assetPrefix: '/app/',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
