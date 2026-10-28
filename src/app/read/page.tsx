import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { FolderBadge, Header } from "@/components/Header";
import { LinkPending } from "@/components/NavPending";
import { ReviewPanel } from "@/components/ReviewPanel";
import { articles, feeds, folders, getDb, reviews } from "@/lib/db";
import { formatDate, monthKey } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReadPage() {
  const db = await getDb();
  const [rows, reviewRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        titleJa: articles.titleJa,
        source: articles.source,
        folder: folders.name,
        readAt: articles.readAt,
        learning: articles.learning,
      })
      .from(articles)
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .leftJoin(folders, eq(folders.id, feeds.folderId))
      .where(eq(articles.status, "read"))
      .orderBy(desc(articles.readAt)),
    db.select().from(reviews),
  ]);

  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = monthKey(r.readAt ?? new Date());
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }
  const reviewOf = new Map(reviewRows.map((r) => [r.month, r.content]));

  return (
    <>
      <Header active="read" />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4">
        {rows.length === 0 && (
          <p className="mt-16 text-center text-muted">読了した記事はまだありません。</p>
        )}
        {[...byMonth].map(([month, items]) => (
          <section key={month} className="mb-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">{month.replace("-", "年")}月</h2>
              <span className="text-sm text-muted">{items.length} 本</span>
            </div>
            <ReviewPanel month={month} initial={reviewOf.get(month) ?? null} />
            <ul className="mt-3 flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {items.map((a) => (
                <li key={a.id} className="pressable-card">
                  <Link href={`/articles/${a.id}`} className="block px-4 py-3">
                    <LinkPending />
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <FolderBadge name={a.folder} />
                      <span className="truncate">{a.source}</span>
                      <span>{formatDate(a.readAt)}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium leading-snug">{a.titleJa ?? a.title}</p>
                    {a.learning && <p className="mt-1 text-sm text-accent">→ {a.learning}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
