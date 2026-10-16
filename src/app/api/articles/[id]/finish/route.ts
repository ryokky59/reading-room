import { asc, eq } from "drizzle-orm";
import { draftFinishNote } from "@/lib/ai";
import { articles, getDb, messages } from "@/lib/db";

export const maxDuration = 120;

// Drafts the learning line and memo; saving happens in the finishArticle action.
export async function POST(_request: Request, ctx: RouteContext<"/api/articles/[id]/finish">) {
  const id = Number((await ctx.params).id);
  const db = await getDb();
  const [article] = await db.select().from(articles).where(eq(articles.id, id));
  if (!article) return Response.json({ error: "not found" }, { status: 404 });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.articleId, id))
    .orderBy(asc(messages.id));
  try {
    const note = await draftFinishNote(
      article,
      history.map((m) => ({ role: m.role, content: m.content })),
    );
    return Response.json(note);
  } catch (err) {
    console.error("finish draft failed", err);
    return Response.json({ error: "draft failed" }, { status: 502 });
  }
}
