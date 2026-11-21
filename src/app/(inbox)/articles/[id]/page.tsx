import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/ArticleView";
import { articles, feeds, folders, getDb, messages } from "@/lib/db";
import { inboxQuery, parseInboxFilter, seenNow } from "@/lib/inbox";

// The header beside the article runs "今すぐ取得" as a server action of this page.
export const maxDuration = 300;

export default async function ArticlePage({ params, searchParams }: PageProps<"/articles/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  // The inbox passes its folder / site filter along so going back keeps it.
  const inboxHref = `/${inboxQuery(parseInboxFilter(await searchParams))}`;

  const db = await getDb();
  const [row] = await db
    .select({ article: articles, folder: folders.name, feedId: feeds.id, feedEnabled: feeds.enabled })
    .from(articles)
    .leftJoin(feeds, eq(feeds.id, articles.feedId))
    .leftJoin(folders, eq(folders.id, feeds.folderId))
    .where(eq(articles.id, id));
  if (!row) notFound();
  const { article, folder, feedId, feedEnabled } = row;
  // Opening an article counts as seeing it. Link prefetches stop at this route's loading.tsx, so
  // only a real visit gets here; a router.refresh() beside the article does too (see
  // CardUnseeButton in InboxShell.tsx).
  if (article.status === "inbox" && !article.seenAt) {
    await db
      .update(articles)
      .set({ seenAt: seenNow })
      .where(and(eq(articles.id, id), eq(articles.status, "inbox"), isNull(articles.seenAt)));
  }
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
        feedId,
        feedEnabled: feedEnabled ?? false,
        folder,
        contentHtml: article.contentHtml,
        contentJa: article.contentJa,
        hasText: Boolean(article.contentHtml || article.contentText),
        excerpt: article.excerpt,
        charCount: article.charCount,
        status: article.status,
        learning: article.learning,
        memo: article.memo,
      }}
      inboxHref={inboxHref}
      initialMessages={history}
    />
  );
}
