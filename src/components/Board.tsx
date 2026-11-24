import { cookies } from "next/headers";
import Link from "next/link";
import { FeedBadge } from "@/components/FeedBadge";
import { FolderTabs } from "@/components/FolderTabs";
import { BoardPane, BoardRow, ColumnUnread, ListedSince, ListLink, MarkAllSeenButton, UnreadCount } from "@/components/InboxShell";
import { LinkPending } from "@/components/NavPending";
import { SeenOnScroll } from "@/components/SeenOnScroll";
import { COLUMN_ROWS, loadBoard, PHONE_ROWS, type BoardColumn, type StoppedFeed } from "@/lib/board";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/board-layout";
import { DIGEST_ATTEMPT_LIMIT, DIGEST_FAILED, formatAgo, formatDate, isForeign, readingMinutes } from "@/lib/format";
import { inboxQuery, parseInboxFilter } from "@/lib/inbox";
import { cutKey } from "@/lib/opened";
import { requestListed } from "@/lib/opened-request";

/**
 * The inbox with no site chosen: a column per feed, grouped by folder. With the `board` variant
 * (globals.css) the columns scroll sideways and each scrolls on its own; phones stack the feeds as
 * sections with a few headlines. Both come from one markup, so the server need not know the
 * screen and a rotated phone just changes layout. Only, a phone gets just the rows it shows: the
 * client tells the layout in a cookie (lib/board-layout.ts). A column shows while it has rows, so
 * that coming back from its last unread article does not pull the page up.
 */
export async function Board({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseInboxFilter(await searchParams);
  const listed = await requestListed();
  const layout = parseLayout((await cookies()).get(LAYOUT_COOKIE)?.value);
  const { groups, stopped, folders, buckets, upTo } = await loadBoard(
    filter,
    listed,
    layout === "stack" ? PHONE_ROWS : COLUMN_ROWS,
  );
  const selected = filter.f === "none" ? null : filter.f ? Number(filter.f) : "all";
  const total = buckets
    .filter((b) => selected === "all" || b.folderId === selected)
    .reduce((t, b) => t + b.n, 0);
  const shown = (c: BoardColumn) => c.unread > 0 || c.rows.length > 0;
  const anyShown = groups.some((g) => g.columns.some(shown));
  const stoppedUnread = stopped.reduce((t, f) => t + f.unread, 0);
  const columns = groups.flatMap((g) => g.columns);
  return (
    <BoardPane
      layout={layout}
      columns={columns.map((c) => c.rows.map((r) => r.id))}
      unseen={columns.flatMap((c) => c.rows.filter((r) => r.seenAt === null).map((r) => r.id))}
    >
      <ListedSince since={listed.since.getTime()} />
      <div className="shrink-0 px-4 pt-3">
        <FolderTabs folders={folders} buckets={buckets} selected={selected} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <ListLink
            query={inboxQuery({ f: filter.f, a: "1" })}
            scroll={false}
            role="switch"
            aria-checked={false}
            className="pressable py-1"
          >
            既読を含む
            <LinkPending />
          </ListLink>
          {selected !== "all" && total > 0 && <MarkAllSeenButton target={{ folderId: selected }} upTo={upTo} screen="board" />}
          <p className="ml-auto">
            <UnreadCount n={total} folder={filter.f} /> 本
          </p>
        </div>
      </div>

      {/* The bottom padding keeps the last section clear of the toast (InboxShell). */}
      <div className="mt-2 flex flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] board:min-h-0 board:flex-1 board:flex-row board:gap-5 board:overflow-x-auto board:overscroll-x-contain board:pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.name}
            className={`${group.columns.some(shown) ? "flex" : "hidden board:flex"} min-w-0 flex-col gap-2 board:min-h-0 board:shrink-0`}
          >
            <h2 className="shrink-0 truncate text-xs font-bold text-muted">{group.name}</h2>
            <div className="flex flex-col gap-4 board:min-h-0 board:flex-1 board:flex-row board:gap-3">
              {group.columns.map((column) => (
                <Column key={column.feedId ?? "none"} column={column} />
              ))}
            </div>
          </section>
        ))}
        {!anyShown && (
          <p className="my-12 text-center text-muted board:my-auto board:w-60 board:shrink-0">
            {stoppedUnread > 0
              ? `止まっているフィードに未読が ${stoppedUnread} 本あります。`
              : "未読の記事はありません。「今すぐ取得」で新着を取ってこられます。"}
          </p>
        )}
        {stopped.length > 0 && <Stopped feeds={stopped} />}
      </div>
    </BoardPane>
  );
}

/**
 * The unread that the first `limit` rows leave out; a seen row kept in place takes up a row. It
 * counts from `unread`, so it is the same whether the column came with PHONE_ROWS rows or all.
 */
function unreadLeft(column: BoardColumn, limit: number) {
  return Math.max(0, column.unread - column.rows.slice(0, limit).filter((r) => r.seenAt === null).length);
}

/**
 * A line under each row but the last one shown. On phones that is the last of the first
 * PHONE_ROWS, whether or not the column came with more (they are hidden): the line stays where
 * it was when the rows after it stop being sent, and 「もっと見る」 below draws its own.
 */
function rowLines(i: number) {
  if (i < PHONE_ROWS - 1) return "border-b last:border-b-0";
  if (i === PHONE_ROWS - 1) return "board:border-b board:last:border-b-0";
  return "hidden board:block border-b last:border-b-0";
}

function Column({ column }: { column: BoardColumn }) {
  const { feedId, name, color, favicon, lastFetchedAt, unread, rows, folder, articleQuery, listQuery } = column;
  const feed = cutKey(feedId);
  const phoneLeft = unreadLeft(column, PHONE_ROWS);
  const columnLeft = unreadLeft(column, COLUMN_ROWS);
  return (
    <section
      aria-label={name}
      data-feed={feedId ?? "none"}
      style={{ borderTopColor: color }}
      className={`${unread > 0 || rows.length > 0 ? "flex" : "hidden board:flex"} ${unread > 0 ? "" : "board:opacity-60"} min-w-0 flex-col overflow-hidden rounded-xl border border-t-[3px] border-line bg-surface board:min-h-0 board:w-[260px] board:shrink-0`}
    >
      <header className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <FeedBadge name={name} color={color} favicon={favicon} />
          <h3 className="min-w-0 flex-1 text-sm font-bold">
            <Link href={`/${listQuery}`} className="pressable block truncate">
              {name}
              <LinkPending />
            </Link>
          </h3>
          <ColumnUnread n={unread} feed={feed} className="shrink-0 text-sm tabular-nums text-accent" />
        </div>
        <div className="mt-0.5 flex min-h-6 items-center gap-2 text-xs text-muted">
          {lastFetchedAt && <span className="truncate">{formatAgo(lastFetchedAt)}に取得</span>}
          {unread > 0 && (
            <span className="ml-auto shrink-0">
              <MarkAllSeenButton target={{ feedId }} upTo={rows[0]?.fetchedAt.getTime() ?? null} screen="board" />
            </span>
          )}
        </div>
      </header>
      <SeenOnScroll
        mode="column"
        feed={feed}
        folder={folder}
        rows={rows.map((r) => ({ id: r.id, seen: r.seenAt !== null }))}
        aria-label={`${name}の記事`}
        className="board:min-h-0 board:flex-1 board:overflow-y-auto board:overscroll-contain"
      >
        {rows.map((row, i) => (
          <BoardRow
            key={row.id}
            id={row.id}
            seen={row.seenAt !== null}
            className={`${rowLines(i)} border-line`}
          >
            {/* A PC prefetches only the first rows, the likeliest to be opened, rather than every
                row a column scrolls past; on phones the rest are hidden and never prefetched. */}
            <Link
              href={`/articles/${row.id}${articleQuery}`}
              prefetch={i < PHONE_ROWS ? null : false}
              className="pressable flex gap-2 px-3 py-2"
            >
              <LinkPending />
              <span aria-hidden="true" style={{ backgroundColor: color }} className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{row.titleJa ?? row.title}</span>
                {i === 0 &&
                  (row.summary ? (
                    <span className="mt-1 line-clamp-3 text-xs leading-snug text-muted">
                      <span className="mr-1 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-medium text-accent">AI 要約</span>
                      {row.summary}
                    </span>
                  ) : (
                    // Given up on, rather than still to come. No excerpt in its place: it would
                    // make the first row several lines taller.
                    row.digestAttempts >= DIGEST_ATTEMPT_LIMIT && (
                      <span className="mt-1 block text-xs leading-snug text-muted">{DIGEST_FAILED}</span>
                    )
                  ))}
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>{formatDate(row.publishedAt ?? row.fetchedAt)}</span>
                  {row.charCount > 0 && <span>{readingMinutes(row.charCount)}分</span>}
                  {isForeign(row.lang, row.title) && <span>英→日</span>}
                  {row.started && <span className="text-accent">対話中</span>}
                </span>
              </span>
            </Link>
          </BoardRow>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">未読はありません</li>}
      </SeenOnScroll>
      {phoneLeft > 0 && (
        <Link
          href={`/${listQuery}`}
          className="pressable block shrink-0 border-t border-line px-3 py-2 text-center text-sm text-accent board:hidden"
        >
          もっと見る(あと {phoneLeft} 件)›
          <LinkPending />
        </Link>
      )}
      {columnLeft > 0 && (
        <Link
          href={`/${listQuery}`}
          className="pressable hidden shrink-0 border-t border-line px-3 py-2 text-center text-xs text-accent board:block"
        >
          あと {columnLeft} 件 ›
          <LinkPending />
        </Link>
      )}
    </section>
  );
}

const STOPPED = "止まっているフィード";

/** The feeds not being fetched, a tap from their articles: a thin column, or folded on phones. */
function Stopped({ feeds }: { feeds: StoppedFeed[] }) {
  const items = (
    <>
      <ul className="board:min-h-0 board:flex-1 board:overflow-y-auto">
        {feeds.map((f) => (
          <li key={f.id} className="border-b border-line px-3 py-2 last:border-b-0">
            <Link href={`/${f.listQuery}`} className="pressable block text-sm font-medium break-words">
              {f.name}
              <LinkPending />
            </Link>
            <p className="mt-0.5 text-xs text-muted" title={f.error ?? undefined}>
              {f.state}
              {f.unread > 0 && ` · 未読 ${f.unread} 本`}
            </p>
          </li>
        ))}
      </ul>
      <Link href="/feeds" className="pressable block shrink-0 border-t border-line px-3 py-2 text-center text-xs text-accent">
        フィード管理 ›
        <LinkPending />
      </Link>
    </>
  );
  return (
    <>
      <details className="rounded-xl border border-line bg-surface board:hidden">
        <summary className="px-3 py-2 text-sm font-bold text-muted">
          {STOPPED} <span className="font-normal">{feeds.length}</span>
        </summary>
        <div className="border-t border-line">{items}</div>
      </details>
      <section
        aria-label={STOPPED}
        className="hidden min-h-0 w-[180px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface board:flex"
      >
        <h2 className="shrink-0 border-b border-line px-3 py-2 text-xs font-bold text-muted">
          {STOPPED} <span className="font-normal">{feeds.length}</span>
        </h2>
        {items}
      </section>
    </>
  );
}
