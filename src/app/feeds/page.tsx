import { asc } from "drizzle-orm";
import { AddFeedForm } from "@/components/AddFeedForm";
import { Header } from "@/components/Header";
import { deleteFeed, setFeedEnabled } from "@/lib/actions";
import { feeds, getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
// Adding a feed imports its articles right away.
export const maxDuration = 300;

const GROUPS = [
  { key: "tech", label: "Tech", color: "text-tech" },
  { key: "business", label: "Business", color: "text-business" },
] as const;

export default async function FeedsPage() {
  const db = await getDb();
  const rows = await db.select().from(feeds).orderBy(asc(feeds.category), asc(feeds.id));

  return (
    <>
      <Header active="feeds" />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-16 pt-4">
        <AddFeedForm />
        <p className="text-sm text-muted">
          新着はおよそ1時間おきに自動で取り込みます。止めたフィードは取り込みの対象から外れます。
        </p>
        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.category === g.key);
          return (
            <section key={g.key}>
              <h2 className={`mb-2 text-sm font-bold ${g.color}`}>
                {g.label} <span className="font-normal text-muted">{list.length}</span>
              </h2>
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
                      </p>
                    </div>
                    <form action={setFeedEnabled.bind(null, f.id, !f.enabled)}>
                      <button className="rounded-full border border-line px-3 py-1 text-xs">
                        {f.enabled ? "止める" : "再開"}
                      </button>
                    </form>
                    <form action={deleteFeed.bind(null, f.id)}>
                      <button className="px-1 py-1 text-xs text-muted" aria-label={`${f.name} を削除`}>
                        削除
                      </button>
                    </form>
                  </li>
                ))}
                {list.length === 0 && <li className="px-4 py-3 text-sm text-muted">まだありません</li>}
              </ul>
            </section>
          );
        })}
      </main>
    </>
  );
}
