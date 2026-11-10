import { sql } from "drizzle-orm";
import { events, getDb } from "@/lib/db";
import { MAX_EVENT_BYTES, parseEvent } from "@/lib/events";

/** The body as text, or null once it is longer than MAX_EVENT_BYTES. */
async function readCapped(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_EVENT_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_EVENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// POST one event from track() (lib/track.ts), sent with navigator.sendBeacon as text: 204 once
// stored, 400 for a body that is too long, not JSON or not a known event.
export async function POST(request: Request) {
  const text = await readCapped(request);
  let body: unknown = null;
  try {
    body = text === null ? null : JSON.parse(text);
  } catch {}
  const event = parseEvent(body);
  if (!event) return new Response(null, { status: 400 });

  const db = await getDb();
  await db.insert(events).values({
    ...event,
    env: process.env.VERCEL_ENV ?? "development",
    // An article deleted meanwhile leaves the event without one, rather than failing the insert.
    articleId: !event.articleId ? null : sql`(SELECT id FROM articles WHERE id = ${event.articleId})`,
  });
  return new Response(null, { status: 204 });
}
