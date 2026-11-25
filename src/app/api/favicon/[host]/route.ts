import { faviconSource } from "@/lib/favicon";

// Well above a favicon: a larger answer is not one.
const MAX_BYTES = 256 * 1024;

const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });

/**
 * A site's favicon, with the service's failures turned into a plain 404. For a host it has no
 * icon for, DuckDuckGo answers 404 with a placeholder image, and an <img> shows that image and
 * cannot read the status; only here can it be told apart, so FeedBadge's onError shows the initial.
 * A redirect is not followed: it could point anywhere, this server's own network included.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/favicon/[host]">) {
  const source = faviconSource((await ctx.params).host);
  if (!source) return missing();
  try {
    const res = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    const body = await res.arrayBuffer();
    if (!res.ok || !type.startsWith("image/") || body.byteLength === 0 || body.byteLength > MAX_BYTES) return missing();
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return missing();
  }
}
