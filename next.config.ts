import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: '/netsim-web/app',
  assetPrefix: '/netsim-web/app/',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
