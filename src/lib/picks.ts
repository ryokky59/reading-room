import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { chooseMorningPicks } from "./ai";
import { articles, feeds, getDb, picks } from "./db";
import { pickDay, readingMinutes } from "./format";
import { inboxQuery } from "./inbox";

/** How many articles the morning picks hold at most. */
export const PICKS = 5;
// What the AI is shown: unread articles fetched in the last day, and what was read in the last month.
const CANDIDATE_HOURS = 24;
const CANDIDATE_LIMIT = 200;
const READ_DAYS = 30;
const READ_LIMIT = 30;

export type SavedPick = { day: string; position: number; articleId: number; reason: string };

async function savedPicks(day: string): Promise<SavedPick[]> {
  const db = await getDb();
  return db
    .select({ day: picks.day, position: picks.position, articleId: picks.articleId, reason: picks.reason })
    .from(picks)
    .where(eq(picks.day, day))
    .orderBy(asc(picks.position));
}

/**
 * Chooses the picks of `day` unless it has some already, and returns them. Called by the hourly
 * cron, so the day's first run that gets an answer from the AI chooses them, and the rest of the
 * day's runs only read them. Nothing is saved when there is nothing to choose from, or the AI
 * chose nothing usable: the next run tries again. A failure of the AI throws.
 */
export async function ensurePicks(day = pickDay()): Promise<SavedPick[]> {
  const saved = await savedPicks(day);
  if (saved.length > 0) return saved;

  const db = await getDb();
  const now = Date.now();
  // The same feeds as the Board's columns: running ones, and 「URL から追加」.
  const running = or(isNull(articles.feedId), and(eq(feeds.enabled, true), isNull(feeds.lastError)));
  const [candidates, read] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        titleJa: articles.titleJa,
        summary: articles.summary,
        source: articles.source,
        charCount: articles.charCount,
      })
      .from(articles)
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .where(
        and(
          eq(articles.status, "inbox"),
          isNull(articles.seenAt),
          isNotNull(articles.summary),
          running,
          gte(articles.fetchedAt, new Date(now - CANDIDATE_HOURS * 3600_000)),
        ),
      )
      .orderBy(desc(articles.fetchedAt), desc(articles.id))
      .limit(CANDIDATE_LIMIT),
    db
      .select({ title: articles.title, titleJa: articles.titleJa, source: articles.source })
      .from(articles)
      .where(and(eq(articles.status, "read"), gte(articles.readAt, new Date(now - READ_DAYS * 86_400_000))))
      .orderBy(desc(articles.readAt))
      .limit(READ_LIMIT),
  ]);
  if (candidates.length === 0) return [];

  const chosen = await chooseMorningPicks(
    candidates.map((c) => ({
      id: c.id,
      title: c.titleJa ?? c.title,
      summary: c.summary ?? "",
      source: c.source,
      minutes: c.charCount > 0 ? readingMinutes(c.charCount) : null,
    })),
    read.map((r) => ({ title: r.titleJa ?? r.title, source: r.source })),
  );
  // Only the candidates' own ids, each once, with a reason.
  const ids = new Set(candidates.map((c) => c.id));
  const seen = new Set<number>();
  const kept = chosen
    .filter((c) => {
      if (!ids.has(c.id) || seen.has(c.id) || !c.reason) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, PICKS);
  if (kept.length === 0) return [];
  // Two runs can both find the day empty and choose while the other does. Every set has a position
  // 0 and (day, position) is unique, so the run that saves position 0 first claims the day, and the
  // rest of its set goes in with it in the same statement (Neon over HTTP has no interactive
  // transactions). A run that loses saves nothing, not even its other positions, and returns the
  // winner's set.
  const [first, ...rest] = kept;
  const claim = sql`insert into ${picks} (day, position, article_id, reason)
    values (${day}, 0, ${first.id}, ${first.reason})
    on conflict do nothing
    returning day`;
  if (rest.length === 0) {
    await db.execute(claim);
  } else {
    const values = sql.join(
      rest.map((c, i) => sql`(${i + 1}::integer, ${c.id}::integer, ${c.reason}::text)`),
      sql`, `,
    );
    await db.execute(sql`with claim as (${claim})
      insert into ${picks} (day, position, article_id, reason)
      select claim.day, v.position, v.article_id, v.reason
      from claim cross join (values ${values}) as v(position, article_id, reason)`);
  }
  return savedPicks(day);
}

export type PickRow = {
  id: number;
  title: string;
  titleJa: string | null;
  source: string;
  lang: string | null;
  charCount: number;
  seenAt: Date | null;
  reason: string;
  /** Search string the article opens with: the same as from its column on the Board. */
  articleQuery: string;
};

/**
 * What the Board shows of the current pick day: `total` is how many were picked, and `rows` those
 * still in the inbox, seen or not, in their order. A total of 0 means none were picked.
 */
export async function loadPicks(day = pickDay()): Promise<{ total: number; rows: PickRow[] }> {
  const db = await getDb();
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(picks).where(eq(picks.day, day)),
    db
      .select({
        id: articles.id,
        title: articles.title,
        titleJa: articles.titleJa,
        source: articles.source,
        lang: articles.lang,
        charCount: articles.charCount,
        seenAt: articles.seenAt,
        reason: picks.reason,
        feedId: articles.feedId,
        folderId: feeds.folderId,
      })
      .from(picks)
      .innerJoin(articles, eq(articles.id, picks.articleId))
      .leftJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(eq(picks.day, day), eq(articles.status, "inbox")))
      .orderBy(asc(picks.position)),
  ]);
  return {
    total,
    rows: rows.map(({ feedId, folderId, ...row }) => ({
      ...row,
      articleQuery:
        feedId === null
          ? inboxQuery({ f: "none" })
          : inboxQuery({ f: folderId === null ? "none" : String(folderId), s: String(feedId) }),
    })),
  };
}
