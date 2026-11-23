import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E 서버가 개발 서버의 .next를 건드리지 않도록 빌드 폴더를 환경 변수로 고른다.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
