import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/ArticleView";
import { articles, getDb, messages } from "@/lib/db";

export default async function ArticlePage({ params }: PageProps<"/articles/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const db = await getDb();
  const [article] = await db.select().from(articles).where(eq(articles.id, id));
  if (!article) notFound();
  const history = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.articleId, id))
    .orderBy(asc(messages.id));

  return (
    <ArticleView
      article={{
        id: article.id,
        title: article.title,
        titleJa: article.titleJa,
        lang: article.lang,
        url: article.url,
        source: article.source,
        category: article.category,
        contentHtml: article.contentHtml,
        contentJa: article.contentJa,
        hasText: Boolean(article.contentHtml || article.contentText),
        excerpt: article.excerpt,
        charCount: article.charCount,
        status: article.status,
        learning: article.learning,
        memo: article.memo,
      }}
      initialMessages={history}
    />
  );
}
