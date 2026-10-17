import type { MetadataRoute } from "next";

// Served by hand instead of app/manifest.ts so the <link> in the layout can send
// credentials: with Vercel Authentication on production, a manifest fetched
// without the auth cookie would be redirected to the Vercel login.
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name: "Reading Room",
    short_name: "Reading",
    description: "テックとビジネスの記事を AI と読む",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#f7f5f0",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "読了一覧", url: "/read" },
      { name: "フィード", url: "/feeds" },
    ],
  };
  return Response.json(manifest, { headers: { "Content-Type": "application/manifest+json" } });
}
