import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { streamReview } from "@/lib/ai";
import { articles, feeds, folders, getDb, messages, reviews } from "@/lib/db";
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
  const read = await db
    .select({
      id: articles.id,
      title: articles.title,
      titleJa: articles.titleJa,
      summary: articles.summary,
      source: articles.source,
      folder: folders.name,
      learning: articles.learning,
      memo: articles.memo,
    })
    .from(articles)
    .leftJoin(feeds, eq(feeds.id, articles.feedId))
    .leftJoin(folders, eq(folders.id, feeds.folderId))
    .where(and(eq(articles.status, "read"), gte(articles.readAt, start), lt(articles.readAt, end)))
    .orderBy(asc(articles.readAt));
  if (read.length === 0) return Response.json({ error: "no articles" }, { status: 400 });

  const chats = await db
    .select({ articleId: messages.articleId, role: messages.role, content: messages.content })
    .from(messages)
    .where(inArray(messages.articleId, read.map((a) => a.id)))
    .orderBy(asc(messages.id));
  const items = read.map(({ id, ...a }) => ({
    ...a,
    chat: chats.filter((m) => m.articleId === id).map(({ role, content }) => ({ role, content })),
  }));

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
