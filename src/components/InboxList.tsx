import { asc, count, eq, max, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderBadge } from "@/components/Header";
import { InboxControls } from "@/components/InboxControls";
import { CardSkipButton, InboxItem, InboxNavSync, ListLink } from "@/components/InboxShell";
import { articles, feeds, folders, getDb } from "@/lib/db";
import { formatDate, formatDateTime, hostname, isForeign, readingMinutes } from "@/lib/format";
import { inboxOrder, inboxQuery, inboxWhere, parseInboxFilter, type InboxFilter } from "@/lib/inbox";

// Cards shown per page; a long list is slow to load and render on phones.
const PAGE_SIZE = 30;

// Unread counts per folder (null = 未分類) and site; articles without a feed count as 未分類.
type Bucket = { folderId: number | null; feedId: number | null; name: string | null; n: number };

/**
 * The unread list with its folder / site chips. It is the whole inbox on phones and the
 * left pane on PCs, where it stays mounted while articles open next to it.
 * `onEmptySite` decides what happens when the selected site has nothing unread left:
 * the inbox redirects to the folder; next to an open article the folder is shown in place.
 */
export async function InboxList({
  searchParams,
  onEmptySite,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  onEmptySite: "redirect" | "folder";
}) {
  return <List filter={parseInboxFilter(await searchParams)} onEmptySite={onEmptySite} />;
}

async function List({ filter, onEmptySite }: { filter: InboxFilter; onEmptySite: "redirect" | "folder" }) {
  const limit = Math.min(Math.max(Number(filter.n) || PAGE_SIZE, PAGE_SIZE), 500);
  const folderId = filter.f && filter.f !== "none" ? Number(filter.f) : null;
  const feedId = filter.s ? Number(filter.s) : null;
  const db = await getDb();
  const [rows, buckets, folderRows, [{ lastFetched }]] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        titleJa: articles.titleJa,
        summary: articles.summary,
        lang: articles.lang,
        url: articles.url,
        source: articles.source,
        folder: folders.name,
        excerpt: articles.excerpt,
        charCount: articles.charCount,
        publishedAt: articles.publishedAt,
        fetchedAt: articles.fetchedAt,
        // Spelled out: drizzle renders ${articles.id} here as a bare "id", which would bind to m.id.
        started: sql<boolean>`exists (select 1 from messages m where m.article_id = articles.id)`,
      })
      .from(articles)
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .leftJoin(folders, eq(folders.id, feeds.folderId))
      .where(inboxWhere(filter))
      .orderBy(...inboxOrder)
      .limit(limit),
    // One aggregate query for every chip's unread count (and the list's total).
    db
      .select({ folderId: feeds.folderId, feedId: articles.feedId, name: feeds.name, n: count() })
      .from(articles)
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .where(eq(articles.status, "inbox"))
      .groupBy(feeds.folderId, articles.feedId, feeds.name),
    db.select({ id: folders.id, name: folders.name }).from(folders).orderBy(asc(folders.position), asc(folders.id)),
    db.select({ lastFetched: max(feeds.lastFetchedAt) }).from(feeds),
  ]);

  const sum = (list: Bucket[]) => list.reduce((t, b) => t + b.n, 0);
  const inFolder = (id: number | null) => buckets.filter((b) => b.folderId === id);
  // A site link may come without its folder; the site's own folder is then highlighted.
  const site = feedId === null ? undefined : buckets.find((b) => b.feedId === feedId);
  if (feedId !== null && !site) {
    // The site has no unread articles left (e.g. its last one was just read): show its folder instead.
    let f = filter.f;
    if (!f) {
      const [feed] = await db.select({ folderId: feeds.folderId }).from(feeds).where(eq(feeds.id, feedId));
      f = feed ? (feed.folderId === null ? "none" : String(feed.folderId)) : undefined;
    }
    if (onEmptySite === "redirect") redirect(`/${inboxQuery({ f, n: filter.n })}`);
    return <List filter={{ f, n: filter.n }} onEmptySite={onEmptySite} />;
  }
  const selectedFolder: number | null | "all" = site
    ? site.folderId
    : filter.f === "none"
      ? null
      : (folderId ?? "all");
  const total =
    feedId !== null
      ? (site?.n ?? 0)
      : selectedFolder === "all"
        ? sum(buckets)
        : sum(inFolder(selectedFolder));
  const unfiledCount = sum(inFolder(null));
  // Sites with no unread articles never show up in the aggregate, so they get no chip.
  const sites = selectedFolder === "all" ? [] : inFolder(selectedFolder).filter((b) => b.feedId !== null);
  sites.sort((a, b) => b.n - a.n || (a.name ?? "").localeCompare(b.name ?? "", "ja"));

  const folderFilter = (id: number | null): InboxFilter => ({ f: id === null ? "none" : String(id) });
  const current: InboxFilter = {
    f: selectedFolder === "all" ? undefined : folderFilter(selectedFolder).f,
    s: feedId === null ? undefined : String(feedId),
    // Kept so going back from an article shows as many cards as before.
    n: limit > PAGE_SIZE ? String(limit) : undefined,
  };
  const moreQuery = inboxQuery(current, { n: String(limit + PAGE_SIZE) });
  const articleQuery = inboxQuery(current);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4">
      <InboxNavSync ids={rows.map((a) => a.id)} />
      <InboxControls />
      <nav aria-label="フォルダ" className="mt-4">
        <ChipRow>
          <Chip query="" label="すべて" count={sum(buckets)} on={selectedFolder === "all"} />
          {folderRows.map((f) => (
            <Chip
              key={f.id}
              query={inboxQuery(folderFilter(f.id))}
              label={f.name}
              count={sum(inFolder(f.id))}
              on={selectedFolder === f.id}
            />
          ))}
          {(unfiledCount > 0 || selectedFolder === null) && (
            <Chip
              query={inboxQuery(folderFilter(null))}
              label="未分類"
              count={unfiledCount}
              on={selectedFolder === null}
            />
          )}
        </ChipRow>
      </nav>
      {selectedFolder !== "all" && sites.length > 0 && (
        <nav aria-label="サイト" className="mt-2">
          <ChipRow small>
            <Chip
              query={inboxQuery(folderFilter(selectedFolder))}
              label="このフォルダすべて"
              on={feedId === null}
              small
            />
            {sites.map((b) => (
              <Chip
                key={b.feedId}
                query={inboxQuery({ ...folderFilter(selectedFolder), s: String(b.feedId) })}
                label={b.name ?? ""}
                count={b.n}
                on={feedId === b.feedId}
                small
              />
            ))}
          </ChipRow>
        </nav>
      )}
      <p className="mt-2 text-right text-xs text-muted">
        {total} 本{lastFetched && ` · 更新 ${formatDateTime(lastFetched)}`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          未読の記事はありません。「今すぐ取得」で新着を取ってこられます。
        </p>
      ) : (
        <ul aria-label="記事" className="mt-2 grid grid-cols-1 gap-2">
          {rows.map((a) => (
            <InboxItem key={a.id} id={a.id}>
              <Link href={`/articles/${a.id}${articleQuery}`} className="block flex-1 px-4 pt-2.5 pb-1">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <FolderBadge name={a.folder} />
                  {/* The host gives way first; a long site name is cut only in the narrower pane below `lg`. */}
                  <span className="min-w-0 truncate font-medium text-text lg:shrink-0">{a.source}</span>
                  <span className="shrink-[999] truncate">{hostname(a.url)}</span>
                  <span className="ml-auto shrink-0">{formatDate(a.publishedAt ?? a.fetchedAt)}</span>
                </div>
                <h2 className="mt-1 font-bold leading-snug">{a.titleJa ?? a.title}</h2>
                {isForeign(a.lang, a.title) && a.titleJa && a.titleJa !== a.title && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">{a.title}</p>
                )}
                {a.summary ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-snug">
                    <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      AI 要約
                    </span>
                    {a.summary}
                  </p>
                ) : (
                  a.excerpt && <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted">{a.excerpt}</p>
                )}
                <div className="mt-1 flex min-h-4 gap-2 text-xs text-muted">
                  {a.charCount > 0 && <span>{readingMinutes(a.charCount)}分</span>}
                  {isForeign(a.lang, a.title) && <span>日本語で読める</span>}
                  {a.started && <span className="text-accent">対話中</span>}
                </div>
              </Link>
              <CardSkipButton id={a.id} />
            </InboxItem>
          ))}
        </ul>
      )}
      {rows.length < total && (
        <ListLink
          query={moreQuery}
          scroll={false}
          className="mx-auto mt-6 block w-fit rounded-full border border-line bg-surface px-5 py-2 text-sm"
        >
          もっと見る(残り {total - rows.length} 本)
        </ListLink>
      )}
    </div>
  );
}

/** A single line of chips that scrolls sideways on its own instead of widening the page. */
function ChipRow({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <ul
      className={`-mx-4 flex overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] ${small ? "gap-1.5" : "gap-2"}`}
    >
      {children}
    </ul>
  );
}

function Chip({
  query,
  label,
  count,
  on,
  small,
}: {
  query: string;
  label: string;
  count?: number;
  on: boolean;
  small?: boolean;
}) {
  return (
    <li className="shrink-0">
      <ListLink
        query={query}
        aria-current={on ? "page" : undefined}
        className={`flex items-center gap-1 whitespace-nowrap rounded-full border ${
          small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
        } ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted"}`}
      >
        {label}
        {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
      </ListLink>
    </li>
  );
}
