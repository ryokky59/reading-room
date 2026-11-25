import { and, eq, max, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip, ChipRow } from "@/components/ChipRow";
import { FeedBadge } from "@/components/FeedBadge";
import { FolderTabs } from "@/components/FolderTabs";
import { FolderBadge } from "@/components/Header";
import { LinkPending } from "@/components/NavPending";
import {
  BoardLink,
  CardActions,
  InboxItem,
  InboxNavSync,
  LeavingGhosts,
  ListedSince,
  ListLink,
  MarkAllSeenButton,
  UnreadCount,
  ViewSwitch,
} from "@/components/InboxShell";
import { SeenOnScroll } from "@/components/SeenOnScroll";
import { feedColor, folderList, unreadBuckets, type Bucket } from "@/lib/board";
import { articles, feeds, folders, getDb } from "@/lib/db";
import { faviconUrl } from "@/lib/favicon";
import {
  DIGEST_ATTEMPT_LIMIT,
  DIGEST_FAILED,
  formatAgo,
  formatDate,
  formatDateTime,
  hostname,
  isForeign,
  readingMinutes,
} from "@/lib/format";
import {
  inboxQuery,
  inboxWhere,
  listedWhere,
  listOrder,
  parseInboxFilter,
  runningWhere,
  type InboxFilter,
  type ListedRows,
} from "@/lib/inbox";
import { cutKey } from "@/lib/opened";
import { requestListed } from "@/lib/opened-request";

// Cards shown per page; a long list is slow to load and render on phones.
const PAGE_SIZE = 30;

/**
 * The list of a feed, under its hero, or of a folder, under its chips (at `/` that takes 既読を含む:
 * without it the folder shows as the Board), or the timeline (`v=t`): every site of the folder
 * tab mixed, newest published first, without site chips or stopped feeds. It is the whole screen
 * on phones and the left pane on PCs, where it stays mounted while articles open next to it.
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
  // `folder` is the list beside an article.
  const listed = await requestListed({ besideArticle: onEmptySite === "folder" });
  return <List filter={parseInboxFilter(await searchParams)} onEmptySite={onEmptySite} listed={listed} />;
}

async function List({
  filter,
  onEmptySite,
  listed,
}: {
  filter: InboxFilter;
  onEmptySite: "redirect" | "folder";
  listed: ListedRows; // the seen articles that stay in the list; see lib/opened.ts
}) {
  const limit = Math.min(Math.max(Number(filter.n) || PAGE_SIZE, PAGE_SIZE), 500);
  const folderId = filter.f && filter.f !== "none" ? Number(filter.f) : null;
  const feedId = filter.s ? Number(filter.s) : null;
  const timeline = filter.v === "t";
  const db = await getDb();
  const [rows, buckets, folderRows, [feed], [tab]] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        titleJa: articles.titleJa,
        summary: articles.summary,
        digestAttempts: articles.digestAttempts,
        lang: articles.lang,
        url: articles.url,
        source: articles.source,
        folder: folders.name,
        excerpt: articles.excerpt,
        charCount: articles.charCount,
        publishedAt: articles.publishedAt,
        fetchedAt: articles.fetchedAt,
        seenAt: articles.seenAt,
        // Every row the list has, past `limit` too; seen rows make this differ from the unread count.
        listed: sql<number>`count(*) over ()`.mapWith(Number),
        // Spelled out: drizzle renders ${articles.id} here as a bare "id", which would bind to m.id.
        started: sql<boolean>`exists (select 1 from messages m where m.article_id = articles.id)`,
      })
      .from(articles)
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .leftJoin(folders, eq(folders.id, feeds.folderId))
      .where(and(listedWhere(filter, listed), timeline ? runningWhere : undefined))
      .orderBy(...listOrder(filter))
      .limit(limit),
    unreadBuckets(),
    folderList(),
    // The feed behind the hero.
    feedId === null
      ? []
      : db
          .select({
            folderId: feeds.folderId,
            name: feeds.name,
            folder: folders.name,
            lastFetchedAt: feeds.lastFetchedAt,
          })
          .from(feeds)
          .leftJoin(folders, eq(folders.id, feeds.folderId))
          .where(eq(feeds.id, feedId)),
    // The timeline's folder tab: its newest unread, which bounds 「すべて既読」 (the cards are not in
    // fetch order), and the unread of its stopped feeds, which it does not show.
    !timeline
      ? []
      : db
          .select({
            newest: max(articles.fetchedAt),
            stopped: sql<number>`count(*) filter (where not ${runningWhere})`.mapWith(Number),
          })
          .from(articles)
          .leftJoin(feeds, eq(feeds.id, articles.feedId))
          .where(inboxWhere({ f: filter.f })),
  ]);

  const sum = (list: Bucket[]) => list.reduce((t, b) => t + b.n, 0);
  const inFolder = (id: number | null) => buckets.filter((b) => b.folderId === id);
  // A site link may come without its folder; the site's own folder is then highlighted.
  let site = feedId === null ? undefined : buckets.find((b) => b.feedId === feedId);
  if (feedId !== null && !site) {
    if (rows.length === 0) {
      // The site has nothing left to show (e.g. its last unread was just read): show its folder instead.
      const f = filter.f ?? (feed ? (feed.folderId === null ? "none" : String(feed.folderId)) : undefined);
      if (onEmptySite === "redirect") redirect(`/${inboxQuery({ f, n: filter.n, a: filter.a })}`);
      return <List filter={{ f, n: filter.n, a: filter.a }} onEmptySite={onEmptySite} listed={listed} />;
    }
    // Nothing unread, but seen articles are listed: the site stays selected.
    site = { folderId: feed?.folderId ?? null, feedId, name: feed?.name ?? null, n: 0 };
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
  // Sites with no unread articles never show up in the aggregate, so they get no chip.
  // Nor does the timeline, which is for reading the sites mixed.
  const sites = selectedFolder === "all" || timeline ? [] : inFolder(selectedFolder).filter((b) => b.feedId !== null);
  if (site?.n === 0) sites.push(site);
  sites.sort((a, b) => b.n - a.n || (a.name ?? "").localeCompare(b.name ?? "", "ja"));

  const folderFilter = (id: number | null): InboxFilter => ({ f: id === null ? "none" : String(id), a: filter.a });
  const current: InboxFilter = {
    f: selectedFolder === "all" ? undefined : folderFilter(selectedFolder).f,
    s: feedId === null ? undefined : String(feedId),
    v: filter.v,
    // Kept so going back from an article shows as many cards as before.
    n: limit > PAGE_SIZE ? String(limit) : undefined,
    a: filter.a,
  };
  const moreQuery = inboxQuery({ ...current, n: String(limit + PAGE_SIZE) });
  const articleQuery = inboxQuery(current);
  const listedTotal = rows[0]?.listed ?? 0;
  // What `total` counts, for the rows scrolled past since (useUnread).
  const countOf =
    feedId !== null ? { feed: String(feedId) } : selectedFolder === "all" ? {} : { folder: cutKey(selectedFolder) };

  // Clipped sideways so a card sliding out does not widen the page or the pane; the bottom
  // padding keeps the last card clear of the toast (InboxShell).
  return (
    <div className="mx-auto max-w-5xl overflow-x-clip px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <InboxNavSync ids={rows.map((a) => a.id)} unseen={rows.filter((a) => a.seenAt === null).map((a) => a.id)} />
      <ListedSince since={listed.since.getTime()} />
      {feedId !== null ? (
        <div>
          <BoardLink className="pressable inline-block py-1 text-sm text-muted">
            ‹ ボード
            <LinkPending />
          </BoardLink>
          <div className="mt-1 flex items-center gap-2">
            <FeedBadge name={site?.name ?? ""} color={feedColor(feedId)} favicon={faviconUrl(rows[0]?.url)} />
            <h2 className="min-w-0 truncate font-bold">{site?.name}</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {feed?.folder ?? "未分類"}
            {feed?.lastFetchedAt && ` · ${formatAgo(feed.lastFetchedAt)}に取得`}
          </p>
        </div>
      ) : (
        <FolderTabs folders={folderRows} buckets={buckets} selected={selectedFolder} v={filter.v} a={filter.a} />
      )}
      {feedId === null && selectedFolder !== "all" && sites.length > 0 && (
        <nav aria-label="サイト" className="mt-2">
          <ChipRow small>
            <Chip query={inboxQuery(folderFilter(selectedFolder))} label="このフォルダすべて" on small />
            {sites.map((b) => (
              <Chip
                key={b.feedId}
                query={inboxQuery({ ...folderFilter(selectedFolder), s: String(b.feedId) })}
                label={b.name ?? ""}
                count={b.n}
                on={false}
                small
              />
            ))}
          </ChipRow>
        </nav>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {timeline && (
          // The Board has only unread: 既読を含む is dropped.
          <ViewSwitch timeline boardQuery={inboxQuery({ f: current.f })} timelineQuery={inboxQuery({ ...current, n: undefined })} />
        )}
        <ListLink
          query={inboxQuery({ ...current, a: filter.a ? undefined : "1" })}
          scroll={false}
          role="switch"
          aria-checked={!!filter.a}
          className={`pressable py-1 ${filter.a ? "font-medium text-accent" : ""}`}
        >
          既読を含む
          <LinkPending />
        </ListLink>
        {selectedFolder !== "all" && total > 0 && (
          <MarkAllSeenButton
            target={feedId !== null ? { feedId } : { folderId: selectedFolder }}
            // The newest row, as the list is newest first; the timeline is not in fetch order.
            upTo={timeline ? (tab?.newest?.getTime() ?? null) : (rows[0]?.fetchedAt.getTime() ?? null)}
            screen={timeline ? "timeline" : "list"}
          />
        )}
        <p className="ml-auto">
          <UnreadCount n={total} {...countOf} /> 本
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          {/* As the Board says it. */}
          {tab && tab.stopped > 0
            ? `止まっているフィードに未読が ${tab.stopped} 本あります。`
            : "未読の記事はありません。「今すぐ取得」で新着を取ってこられます。"}
        </p>
      ) : (
        <SeenOnScroll
          // A feed's unread list is skimmed; 既読を含む and a folder's list mark nothing.
          mode={feedId !== null && !filter.a ? "list" : null}
          feed={cutKey(feedId)}
          folder={cutKey(site?.folderId ?? null)}
          rows={rows.map((a) => ({ id: a.id, seen: a.seenAt !== null }))}
          aria-label="記事"
          className="mt-2 grid grid-cols-1 gap-2"
        >
          {rows.map((a) => (
            <InboxItem key={a.id} id={a.id} seen={a.seenAt !== null}>
              <Link href={`/articles/${a.id}${articleQuery}`} className="block flex-1 px-4 pt-2.5 pb-1">
                <LinkPending />
                <div className="flex items-center gap-2 text-xs text-muted">
                  <FolderBadge name={a.folder} />
                  {/* The host gives way first; a long site name is cut only in the narrower pane below `lg`. */}
                  <span className="min-w-0 truncate font-medium text-text lg:shrink-0">{a.source}</span>
                  <span className="shrink-[999] truncate">{hostname(a.url)}</span>
                  {/* The timeline's order, to the minute: a day alone would not show it. */}
                  <span className="ml-auto shrink-0">
                    {timeline ? formatDateTime(timelineTimeOf(a)) : formatDate(a.publishedAt ?? a.fetchedAt)}
                  </span>
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
                  <>
                    {a.digestAttempts >= DIGEST_ATTEMPT_LIMIT && (
                      <p className="mt-1 text-xs text-muted">{DIGEST_FAILED}</p>
                    )}
                    {a.excerpt && <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted">{a.excerpt}</p>}
                  </>
                )}
                {/* The right end is CardActions' button's: スキップ, or the wider 「未読に戻す」. In a
                    narrow pane all three do not fit beside it, and 日本語で読める is cut short. */}
                <div className="mt-1 flex min-h-4 gap-2 pr-14 text-xs text-muted group-data-unsee/card:pr-18">
                  {a.charCount > 0 && <span className="shrink-0">{readingMinutes(a.charCount)}分</span>}
                  {isForeign(a.lang, a.title) && <span className="min-w-0 truncate">日本語で読める</span>}
                  {a.started && <span className="shrink-0 text-accent">対話中</span>}
                </div>
              </Link>
              <CardActions id={a.id} seen={a.seenAt !== null} />
            </InboxItem>
          ))}
          <LeavingGhosts before={null} />
        </SeenOnScroll>
      )}
      {rows.length < listedTotal && (
        <ListLink
          query={moreQuery}
          scroll={false}
          className="pressable mx-auto mt-6 block w-fit rounded-full border border-line bg-surface px-5 py-2 text-sm"
        >
          もっと見る(残り {listedTotal - rows.length} 本)
          <LinkPending />
        </ListLink>
      )}
    </div>
  );
}

/** When the timeline places an article (timelineTime in lib/inbox.ts): published, but no later than fetched. */
function timelineTimeOf(a: { publishedAt: Date | null; fetchedAt: Date }) {
  return a.publishedAt && a.publishedAt < a.fetchedAt ? a.publishedAt : a.fetchedAt;
}
