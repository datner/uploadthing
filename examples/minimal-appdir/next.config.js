/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {optimizePackageImports: ["@uploadthing/react", "uploadthing", "effect", "@effect/schema"]},
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
