import { asc, eq } from "drizzle-orm";
import { KICKOFF, streamChat, type Turn } from "@/lib/ai";
import { articles, getDb, messages } from "@/lib/db";

export const maxDuration = 300;

// POST {} starts the conversation with a summary; POST { message } continues it.
export async function POST(request: Request, ctx: RouteContext<"/api/articles/[id]/chat">) {
  const id = Number((await ctx.params).id);
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = body.message?.trim();

  const db = await getDb();
  const [article] = await db.select().from(articles).where(eq(articles.id, id));
  if (!article) return Response.json({ error: "not found" }, { status: 404 });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.articleId, id))
    .orderBy(asc(messages.id));
  if (!message && history.length > 0) {
    return Response.json({ error: "message required" }, { status: 400 });
  }
  if (message) {
    await db.insert(messages).values({ articleId: id, role: "user", content: message });
  }

  // The kickoff prompt is implied, not stored: a conversation that began with the
  // summary has an assistant message first. One that began with a question has none.
  const summarized = message ? history[0]?.role === "assistant" : true;
  const turns: Turn[] = [
    ...(summarized ? [{ role: "user" as const, content: KICKOFF }] : []),
    ...history.map((m) => ({ role: m.role, content: m.content })),
    ...(message ? [{ role: "user" as const, content: message }] : []),
  ];

  const stream = streamChat(article, turns, async (text) => {
    await db.insert(messages).values({ articleId: id, role: "assistant", content: text });
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
