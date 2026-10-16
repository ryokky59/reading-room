import { and, asc, eq, gte, lt } from "drizzle-orm";
import { streamReview } from "@/lib/ai";
import { articles, getDb, reviews } from "@/lib/db";
import { monthRange } from "@/lib/format";

export const maxDuration = 300;

// POST { month: "YYYY-MM" } streams a fresh look-back and stores it.
export async function POST(request: Request) {
  const { month } = (await request.json()) as { month?: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "month required" }, { status: 400 });
  }
  const [start, end] = monthRange(month);
  const db = await getDb();
  const items = await db
    .select({
      title: articles.title,
      source: articles.source,
      category: articles.category,
      learning: articles.learning,
      memo: articles.memo,
    })
    .from(articles)
    .where(and(eq(articles.status, "read"), gte(articles.readAt, start), lt(articles.readAt, end)))
    .orderBy(asc(articles.readAt));
  if (items.length === 0) return Response.json({ error: "no articles" }, { status: 400 });

  const stream = streamReview(month, items, async (content) => {
    await db
      .insert(reviews)
      .values({ month, content })
      .onConflictDoUpdate({ target: reviews.month, set: { content, createdAt: new Date() } });
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
