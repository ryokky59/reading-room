import { cookies } from "next/headers";
import Link from "next/link";
import { FeedBadge } from "@/components/FeedBadge";
import { FolderTabs } from "@/components/FolderTabs";
import { BoardPane, BoardRow, InboxNavSync, ListLink, MarkAllSeenButton } from "@/components/InboxShell";
import { LinkPending } from "@/components/NavPending";
import { COLUMN_ROWS, loadBoard, PHONE_ROWS, type BoardColumn, type StoppedFeed } from "@/lib/board";
import { formatAgo, formatDate, isForeign, readingMinutes } from "@/lib/format";
import { inboxQuery, parseInboxFilter } from "@/lib/inbox";
import { OPENED_COOKIE, parseOpened } from "@/lib/opened";

/**
 * The inbox with no site chosen: a column per feed, grouped by folder. From `split` up the columns
 * scroll sideways and each scrolls on its own; phones stack the feeds as sections with a few
 * headlines, on the window's scroll. Both come from one markup, so the server need not know
 * the screen and a rotated phone just changes layout.
 */
export async function Board({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseInboxFilter(await searchParams);
  const opened = parseOpened((await cookies()).get(OPENED_COOKIE)?.value);
  const { groups, stopped, folders, buckets } = await loadBoard(filter, opened);
  const selected = filter.f === "none" ? null : filter.f ? Number(filter.f) : "all";
  const total = buckets
    .filter((b) => selected === "all" || b.folderId === selected)
    .reduce((t, b) => t + b.n, 0);
  const anyUnread = groups.some((g) => g.columns.some((c) => c.unread > 0));
  return (
    <BoardPane>
      <InboxNavSync ids={groups.flatMap((g) => g.columns.flatMap((c) => c.rows.map((r) => r.id)))} />
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
          {selected !== "all" && total > 0 && <MarkAllSeenButton target={{ folderId: selected }} />}
          <p className="ml-auto">{total} 本</p>
        </div>
      </div>

      {/* The bottom padding keeps the last section clear of the toast (InboxShell). */}
      <div className="mt-2 flex flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] split:min-h-0 split:flex-1 split:flex-row split:gap-5 split:overflow-x-auto split:overscroll-x-contain split:pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.name}
            className={`${group.columns.some((c) => c.unread > 0) ? "flex" : "hidden split:flex"} min-w-0 flex-col gap-2 split:min-h-0 split:shrink-0`}
          >
            <h2 className="shrink-0 truncate text-xs font-bold text-muted">{group.name}</h2>
            <div className="flex flex-col gap-4 split:min-h-0 split:flex-1 split:flex-row split:gap-3">
              {group.columns.map((column) => (
                <Column key={column.feedId ?? "none"} column={column} />
              ))}
            </div>
          </section>
        ))}
        {!anyUnread && (
          <p className="my-12 text-center text-muted split:my-auto split:w-60 split:shrink-0">
            未読の記事はありません。「今すぐ取得」で新着を取ってこられます。
          </p>
        )}
        {stopped.length > 0 && <Stopped feeds={stopped} />}
      </div>
    </BoardPane>
  );
}

/** The unread that the first `limit` rows leave out; a seen row kept in place takes up a row. */
function unreadLeft(column: BoardColumn, limit: number) {
  return Math.max(0, column.unread - column.rows.slice(0, limit).filter((r) => r.seenAt === null).length);
}

function Column({ column }: { column: BoardColumn }) {
  const { feedId, name, color, favicon, lastFetchedAt, unread, rows, articleQuery, listQuery } = column;
  const phoneLeft = unreadLeft(column, PHONE_ROWS);
  const columnLeft = unreadLeft(column, COLUMN_ROWS);
  return (
    <section
      aria-label={name}
      data-feed={feedId ?? "none"}
      style={{ borderTopColor: color }}
      className={`${unread > 0 ? "flex" : "hidden split:flex split:opacity-60"} min-w-0 flex-col overflow-hidden rounded-xl border border-t-[3px] border-line bg-surface split:min-h-0 split:w-[260px] split:shrink-0`}
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
          <span aria-label={`未読 ${unread} 本`} className="shrink-0 text-sm tabular-nums text-accent">
            {unread}
          </span>
        </div>
        <div className="mt-0.5 flex min-h-6 items-center gap-2 text-xs text-muted">
          {lastFetchedAt && <span className="truncate">{formatAgo(lastFetchedAt)}に取得</span>}
          {unread > 0 && (
            <span className="ml-auto shrink-0">
              <MarkAllSeenButton target={{ feedId }} rows={rows.map((r) => r.id)} />
            </span>
          )}
        </div>
      </header>
      <ul aria-label={`${name}の記事`} className="split:min-h-0 split:flex-1 split:overflow-y-auto split:overscroll-contain">
        {rows.map((row, i) => (
          <BoardRow
            key={row.id}
            id={row.id}
            seen={row.seenAt !== null}
            className={`${i < PHONE_ROWS ? "" : "hidden split:block"} border-b border-line last:border-b-0`}
          >
            <Link href={`/articles/${row.id}${articleQuery}`} className="pressable flex gap-2 px-3 py-2">
              <LinkPending />
              <span aria-hidden="true" style={{ backgroundColor: color }} className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{row.titleJa ?? row.title}</span>
                {i === 0 && row.summary && (
                  <span className="mt-1 line-clamp-3 text-xs leading-snug text-muted">
                    <span className="mr-1 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-medium text-accent">AI 要約</span>
                    {row.summary}
                  </span>
                )}
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
      </ul>
      {phoneLeft > 0 && (
        <Link
          href={`/${listQuery}`}
          className="pressable block shrink-0 border-t border-line px-3 py-2 text-center text-sm text-accent split:hidden"
        >
          もっと見る(あと {phoneLeft} 件)›
          <LinkPending />
        </Link>
      )}
      {columnLeft > 0 && (
        <Link
          href={`/${listQuery}`}
          className="pressable hidden shrink-0 border-t border-line px-3 py-2 text-center text-xs text-accent split:block"
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
      <ul className="split:min-h-0 split:flex-1 split:overflow-y-auto">
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
      <details className="rounded-xl border border-line bg-surface split:hidden">
        <summary className="px-3 py-2 text-sm font-bold text-muted">
          {STOPPED} <span className="font-normal">{feeds.length}</span>
        </summary>
        <div className="border-t border-line">{items}</div>
      </details>
      <section
        aria-label={STOPPED}
        className="hidden min-h-0 w-[180px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface split:flex"
      >
        <h2 className="shrink-0 border-b border-line px-3 py-2 text-xs font-bold text-muted">
          {STOPPED} <span className="font-normal">{feeds.length}</span>
        </h2>
        {items}
      </section>
    </>
  );
}
