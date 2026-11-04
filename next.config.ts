import type { NextConfig } from "next";
import { FAL_MEDIA_HOSTS } from "./src/lib/media";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Serve fal results from our own domain (proxied by Vercel's edge). See src/lib/media.ts.
  async rewrites() {
    return Object.entries(FAL_MEDIA_HOSTS).map(([host, key]) => ({
      source: `/fm/${key}/:path*`,
      destination: `https://${host}/:path*`,
    }));
  },
};

export default nextConfig;
