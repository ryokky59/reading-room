import { eq } from "drizzle-orm";
import { streamTranslation } from "@/lib/ai";
import { articles, getDb } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/extract";

export const maxDuration = 300;

// Streams the Japanese translation of a non-Japanese article and stores it once complete.
export async function POST(_request: Request, ctx: RouteContext<"/api/articles/[id]/translate">) {
  const id = Number((await ctx.params).id);
  const db = await getDb();
  const [article] = await db.select().from(articles).where(eq(articles.id, id));
  if (!article) return Response.json({ error: "not found" }, { status: 404 });

  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (article.contentJa) return new Response(article.contentJa, { headers });

  const markdown = article.contentHtml ? htmlToMarkdown(article.contentHtml) : article.contentText;
  if (!markdown) return Response.json({ error: "no content" }, { status: 400 });

  const stream = streamTranslation({ title: article.title, markdown }, async (text) => {
    await db.update(articles).set({ contentJa: text }).where(eq(articles.id, id));
  });
  return new Response(stream, { headers });
}
