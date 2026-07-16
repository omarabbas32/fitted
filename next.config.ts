import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "@prisma/adapter-mariadb",
    "mariadb",
    "unpdf",
  ],
};

export default nextConfig;
