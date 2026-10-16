import type { NextConfig } from "next";

// All pages read live data behind a login cookie, so Cache Components buys nothing here.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // Lets a phone on the home Wi-Fi open `npm run dev` by the Mac's LAN address.
  allowedDevOrigins: ["192.168.*.*", "*.local"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
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
