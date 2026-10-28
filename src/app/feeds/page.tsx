import { asc, count, isNotNull } from "drizzle-orm";
import { AddFeedForm } from "@/components/AddFeedForm";
import { FeedFolderSelect } from "@/components/FeedFolderSelect";
import { Header } from "@/components/Header";
import { FolderHeader } from "@/components/FolderHeader";
import { createFolder, deleteFeed, setFeedEnabled } from "@/lib/actions";
import { articles, feeds, folders, getDb, type Feed } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
// Adding a feed imports its articles right away.
export const maxDuration = 300;

export default async function FeedsPage() {
  const db = await getDb();
  const [folderRows, rows, counts] = await Promise.all([
    db.select().from(folders).orderBy(asc(folders.position), asc(folders.id)),
    db.select().from(feeds).orderBy(asc(feeds.id)),
    db
      .select({ feedId: articles.feedId, n: count() })
      .from(articles)
      .where(isNotNull(articles.feedId))
      .groupBy(articles.feedId),
  ]);
  const articleCount = new Map(counts.map((c) => [c.feedId, c.n]));
  const folderOptions = folderRows.map((f) => ({ id: f.id, name: f.name }));
  const known = new Set(folderRows.map((f) => f.id));
  const unfiled = rows.filter((r) => r.folderId === null || !known.has(r.folderId));

  const feedList = (list: Feed[]) => (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
      {list.map((f) => (
        <li key={f.id} className={`flex items-start gap-3 px-4 py-3 ${f.enabled ? "" : "opacity-50"}`}>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{f.name}</p>
            <p className="truncate text-xs text-muted">{f.url}</p>
            <p className="mt-0.5 text-xs text-muted">
              {f.lastError ? (
                <span className="text-accent">取得失敗: {f.lastError}</span>
              ) : f.lastFetchedAt ? (
                `最終取得 ${formatDateTime(f.lastFetchedAt)}`
              ) : (
                "まだ取得していません"
              )}
              {` · 記事 ${articleCount.get(f.id) ?? 0} 本`}
            </p>
            <FeedFolderSelect feedId={f.id} feedName={f.name} folderId={f.folderId} folders={folderOptions} />
          </div>
          <form action={setFeedEnabled.bind(null, f.id, !f.enabled)}>
            <button className="pressable rounded-full border border-line px-3 py-1 text-xs">
              {f.enabled ? "止める" : "再開"}
            </button>
          </form>
          <form action={deleteFeed.bind(null, f.id)}>
            <button className="pressable px-1 py-1 text-xs text-muted" aria-label={`${f.name} を削除`}>
              削除
            </button>
          </form>
        </li>
      ))}
      {list.length === 0 && <li className="px-4 py-3 text-sm text-muted">まだありません</li>}
    </ul>
  );

  return (
    <>
      <Header active="feeds" />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-16 pt-4">
        <AddFeedForm folders={folderOptions} />
        <form action={createFolder} className="flex gap-2 rounded-xl border border-line bg-surface p-4">
          <input
            name="name"
            required
            aria-label="新しいフォルダ名"
            placeholder="新しいフォルダ(例: 毎朝読む)"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-base"
          />
          <button className="pressable shrink-0 rounded-full border border-line px-4 py-1.5 text-sm">フォルダを作成</button>
        </form>
        <p className="text-sm text-muted">
          新着はおよそ1時間おきに自動で取り込みます。止めたフィードは取り込みの対象から外れます。
        </p>
        {folderRows.map((folder, i) => {
          const list = rows.filter((r) => r.folderId === folder.id);
          return (
            <section key={folder.id} aria-label={folder.name}>
              <FolderHeader
                id={folder.id}
                name={folder.name}
                feedCount={list.length}
                first={i === 0}
                last={i === folderRows.length - 1}
              />
              {feedList(list)}
            </section>
          );
        })}
        {(unfiled.length > 0 || folderRows.length === 0) && (
          <section aria-label="未分類">
            <h2 className="mb-2 text-sm font-bold text-muted">
              未分類 <span className="font-normal">{unfiled.length}</span>
            </h2>
            {feedList(unfiled)}
          </section>
        )}
      </main>
    </>
  );
}
