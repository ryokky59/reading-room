import { and, count, desc, eq, max, sql } from "drizzle-orm";
import Link from "next/link";
import { CategoryBadge, Header } from "@/components/Header";
import { InboxControls } from "@/components/InboxControls";
import { skipArticle } from "@/lib/actions";
import { articles, feeds, getDb } from "@/lib/db";
import { formatDate, formatDateTime, hostname, isForeign, readingMinutes } from "@/lib/format";

// "今すぐ取得" runs here as a server action and can take a while.
export const maxDuration = 300;

// Cards shown per page; a long list is slow to load and render on phones.
const PAGE_SIZE = 30;

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "tech", label: "Tech" },
  { key: "business", label: "Business" },
] as const;

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const { c, n } = await searchParams;
  const category = c === "tech" || c === "business" ? c : "all";
  const limit = Math.min(Math.max(Number(n) || PAGE_SIZE, PAGE_SIZE), 500);
  const where = and(eq(articles.status, "inbox"), category === "all" ? undefined : eq(articles.category, category));

  const db = await getDb();
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      titleJa: articles.titleJa,
      summary: articles.summary,
      lang: articles.lang,
      url: articles.url,
      source: articles.source,
      category: articles.category,
      excerpt: articles.excerpt,
      charCount: articles.charCount,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
      started: sql<boolean>`exists (select 1 from messages m where m.article_id = ${articles.id})`,
    })
    .from(articles)
    .where(where)
    .orderBy(desc(articles.fetchedAt), desc(articles.publishedAt))
    .limit(limit);
  const [[{ total }], [{ lastFetched }]] = await Promise.all([
    db.select({ total: count() }).from(articles).where(where),
    db.select({ lastFetched: max(feeds.lastFetchedAt) }).from(feeds),
  ]);
  const moreHref = `/?${new URLSearchParams({ ...(category !== "all" && { c: category }), n: String(limit + PAGE_SIZE) })}`;

  return (
    <>
      <Header active="inbox" />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4">
        <InboxControls />
        <div className="mt-4 flex gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/" : `/?c=${f.key}`}
              className={`rounded-full px-3 py-1 text-sm ${
                category === f.key ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              {f.label}
            </Link>
          ))}
          <span className="ml-auto self-center text-right text-xs text-muted">
            {total} 本
            {lastFetched && <span className="block">更新 {formatDateTime(lastFetched)}</span>}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-16 text-center text-muted">
            未読の記事はありません。「今すぐ取得」で新着を取ってこられます。
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-col rounded-xl border border-line bg-surface">
                <Link href={`/articles/${a.id}`} className="block flex-1 px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <CategoryBadge category={a.category} />
                    <span className="shrink-0 font-medium text-text">{a.source}</span>
                    <span className="truncate">{hostname(a.url)}</span>
                    <span className="ml-auto shrink-0">{formatDate(a.publishedAt ?? a.fetchedAt)}</span>
                  </div>
                  <h2 className="mt-1.5 font-bold leading-snug">{a.titleJa ?? a.title}</h2>
                  {isForeign(a.lang, a.title) && a.titleJa && a.titleJa !== a.title && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{a.title}</p>
                  )}
                  {a.summary ? (
                    <p className="mt-2 text-sm leading-relaxed">
                      <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        AI 要約
                      </span>
                      {a.summary}
                    </p>
                  ) : (
                    a.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted">{a.excerpt}</p>
                  )}
                  <div className="mt-2 flex gap-2 text-xs text-muted">
                    {a.charCount > 0 && <span>{readingMinutes(a.charCount)}分</span>}
                    {isForeign(a.lang, a.title) && <span>日本語で読める</span>}
                    {a.started && <span className="text-accent">対話中</span>}
                  </div>
                </Link>
                <form action={skipArticle.bind(null, a.id)} className="flex justify-end px-2 pb-1">
                  <button className="px-2 py-1 text-xs text-muted">スキップ</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {rows.length < total && (
          <Link
            href={moreHref}
            scroll={false}
            className="mx-auto mt-6 block w-fit rounded-full border border-line bg-surface px-5 py-2 text-sm"
          >
            もっと見る(残り {total - rows.length} 本)
          </Link>
        )}
      </main>
    </>
  );
}
