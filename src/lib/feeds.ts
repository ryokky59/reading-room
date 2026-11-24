import "server-only";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";
import { digestArticle, type Digest } from "./ai";
import { articles, feeds, getDb, type Feed } from "./db";
import { EMPTY, extractArticle } from "./extract";
import { DIGEST_ATTEMPT_LIMIT } from "./format";

type Candidate = {
  url: string;
  title: string;
  source: string;
  feedId: number | null; // null for articles added by URL
  publishedAt: Date | null;
  summary: string | null;
};

export type FetchResult = { added: number; failedFeeds: string[] };

// A fresh parser for each parse: after a parse error, rss-parser's next parse of the same bad
// XML returns one empty item instead of failing, so the retry below hid broken feeds.
const parseFeed = (url: string) =>
  new Parser({ timeout: 15_000, headers: { "User-Agent": "reading-room/1.0" } }).parseURL(url);

async function collect(feed: Feed): Promise<Candidate[]> {
  const since = Date.now() - feed.days * 86_400_000;
  // Feed hosts time out now and then; one retry clears most of it.
  const parsed = await parseFeed(feed.url).catch(() => parseFeed(feed.url));
  return parsed.items
    .map((item) => {
      const date = item.isoDate ?? item.pubDate;
      return {
        url: item.link?.trim() ?? "",
        title: item.title?.trim() ?? "(無題)",
        source: feed.name,
        feedId: feed.id,
        publishedAt: date ? new Date(date) : null,
        summary: item.contentSnippet?.slice(0, 300) ?? null,
      };
    })
    .filter((c) => c.url && (!c.publishedAt || c.publishedAt.getTime() >= since))
    .slice(0, feed.itemLimit);
}

async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// Postgres rejects NUL in text, and one such value fails the whole batch insert. linkedom and
// Readability keep NUL from the page, and feeds can carry it in titles and snippets.
const stripNul = (s: string) => s.replaceAll("\0", "");

function withoutNul<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? stripNul(v) : v])) as T;
}

// Just the message and code: Drizzle's message and PGlite's error both carry the query's
// params, which are whole article bodies.
function brief(err: unknown): string {
  const e = (err instanceof Error && err.cause) || err;
  if (!(e instanceof Error)) return String(e);
  const code = "code" in e && e.code ? ` (${e.code})` : "";
  return e.message + code;
}

async function save(input: Candidate[]): Promise<number> {
  if (input.length === 0) return 0;
  const candidates = input.map(withoutNul);
  const db = await getDb();
  const known = await db
    .select({ url: articles.url })
    .from(articles)
    .where(inArray(articles.url, candidates.map((c) => c.url)));
  const knownSet = new Set(known.map((k) => k.url));
  const fresh = [...new Map(candidates.filter((c) => !knownSet.has(c.url)).map((c) => [c.url, c])).values()];

  const rows = await mapLimit(fresh, 6, async (c) => {
    // Anything unexpected while extracting one article saves it without its body rather than
    // failing every article in the run.
    const ex = withoutNul(
      await extractArticle(c.url).catch((err) => {
        console.error("extract failed", c.url, err);
        return EMPTY;
      }),
    );
    const title = c.title !== "(無題)" ? c.title : (ex.title ?? c.title);
    const excerpt = ex.excerpt ?? c.summary;
    const digest = await tryDigest({ title, text: ex.text, excerpt }, 0);
    return withoutNul({
      url: c.url,
      title,
      ...digest,
      source: c.source,
      feedId: c.feedId,
      publishedAt: c.publishedAt,
      contentHtml: ex.html,
      contentText: ex.text,
      excerpt,
      charCount: ex.text?.length ?? 0,
    });
  });
  if (rows.length === 0) return 0;
  const insert = (values: typeof rows) =>
    db.insert(articles).values(values).onConflictDoNothing({ target: articles.url }).returning({ id: articles.id });
  try {
    return (await insert(rows)).length;
  } catch (err) {
    // One bad row fails the whole batch, so save the rows one by one and skip the ones that fail.
    console.error("batch insert failed; saving one by one", brief(err));
    let added = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        added += (await insert([row])).length;
      } catch (rowErr) {
        failed++;
        console.error("insert failed", row.url, brief(rowErr));
      }
    }
    // When every row fails the cause is not in the rows (say, a missing migration), so the
    // run must fail rather than report 0 new articles.
    if (rows.length > 1 && failed === rows.length) throw err;
    return added;
  }
}

/**
 * How long a failed digest waits before it is tried again. Every run (the hourly cron,
 * 「今すぐ取得」, adding a feed) catches up on failed digests, so without a wait the attempts
 * would count runs, not time: a few presses during an outage would use them all up in minutes.
 * 45 minutes, not 60, so the hourly cron still retries each time when it starts a few minutes
 * late or the clocks differ; with DIGEST_ATTEMPT_LIMIT tries that rides out at least 3 hours.
 * E2E sets 20 seconds through the environment (e2e/env.ts).
 */
const DIGEST_RETRY_INTERVAL_MS = Number(process.env.DIGEST_RETRY_INTERVAL_MS) || 45 * 60_000;

type DigestColumns = Partial<Digest> & { digestAttempts: number; digestError: string | null; digestTriedAt: Date };

/** Returns the columns to store: the digest if it worked, and the record of this attempt. */
async function tryDigest(a: Parameters<typeof digestArticle>[0], attempts: number): Promise<DigestColumns> {
  try {
    return { ...(await digestArticle(a)), digestAttempts: attempts + 1, digestError: null, digestTriedAt: new Date() };
  } catch (err) {
    console.error("digest failed", a.title, err);
    const digestError = brief(err).slice(0, 200);
    // A refusal would only repeat, so it uses up the attempts at once.
    const digestAttempts = digestError === "refused" ? DIGEST_ATTEMPT_LIMIT : attempts + 1;
    return { digestAttempts, digestError, digestTriedAt: new Date() };
  }
}

/**
 * Fills in the AI title/summary for unread articles that don't have one yet and still have
 * attempts left. An article tried within DIGEST_RETRY_INTERVAL_MS waits, including one save()
 * tried moments ago in the same run: another try so soon would use up an attempt on the same
 * outage.
 *
 * Runs can overlap (the cron still going when 「今すぐ取得」 is pressed), so each article is
 * claimed by writing digestTriedAt before the AI is called: the other run then sees it as tried
 * within the interval and leaves it. An article whose run dies after the claim is tried again
 * after the interval, its attempts unchanged.
 */
async function digestMissing(limit: number): Promise<void> {
  const db = await getDb();
  const due = and(
    eq(articles.status, "inbox"),
    isNull(articles.summary),
    lt(articles.digestAttempts, DIGEST_ATTEMPT_LIMIT),
    or(isNull(articles.digestTriedAt), lt(articles.digestTriedAt, new Date(Date.now() - DIGEST_RETRY_INTERVAL_MS))),
  );
  const rows = await db
    .update(articles)
    .set({ digestTriedAt: new Date() })
    // `due` again outside the subquery: a run that waited on another's lock checks the row
    // again as the other left it, and drops it. SKIP LOCKED takes the next ones instead of waiting.
    .where(
      and(
        due,
        inArray(
          articles.id,
          db
            .select({ id: articles.id })
            .from(articles)
            .where(due)
            .orderBy(desc(articles.fetchedAt))
            .limit(limit)
            .for("update", { skipLocked: true }),
        ),
      ),
    )
    .returning({
      id: articles.id,
      title: articles.title,
      text: articles.contentText,
      excerpt: articles.excerpt,
      attempts: articles.digestAttempts,
    });
  await mapLimit(rows, 6, async (r) => {
    const digest = await tryDigest(r, r.attempts);
    // Not worth failing the run: the article is simply tried again next time.
    await db
      .update(articles)
      .set(withoutNul(digest))
      .where(eq(articles.id, r.id))
      .catch((err) => console.error("digest update failed", r.id, brief(err)));
  });
}

/** Collects from the given feeds, recording each feed's outcome. */
async function run(list: Feed[]): Promise<FetchResult> {
  const db = await getDb();
  const failedFeeds: string[] = [];
  const lists = await Promise.all(
    list.map(async (f) => {
      try {
        const items = await collect(f);
        await db.update(feeds).set({ lastFetchedAt: new Date(), lastError: null }).where(eq(feeds.id, f.id));
        return items;
      } catch (err) {
        failedFeeds.push(f.name);
        await db
          .update(feeds)
          // Parser errors quote the offending character, which can be NUL.
          .set({ lastFetchedAt: new Date(), lastError: stripNul(String(err instanceof Error ? err.message : err)).slice(0, 200) })
          .where(eq(feeds.id, f.id));
        return [];
      }
    }),
  );
  const added = await save(lists.flat());
  // Catches up on articles saved before digests existed or whose digest failed.
  await digestMissing(60);
  return { added, failedFeeds };
}

export async function fetchAllFeeds(): Promise<FetchResult> {
  const db = await getDb();
  return run(await db.select().from(feeds).where(eq(feeds.enabled, true)));
}

export async function fetchFeed(id: number): Promise<FetchResult> {
  const db = await getDb();
  return run(await db.select().from(feeds).where(eq(feeds.id, id)));
}

export async function addUrl(url: string): Promise<number | null> {
  const db = await getDb();
  await save([{ url, title: "(無題)", source: new URL(url).hostname, feedId: null, publishedAt: null, summary: null }]);
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(inArray(articles.url, [url]));
  return row?.id ?? null;
}

export type DiscoveredFeed = { url: string; title: string };

const COMMON_FEED_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed/"];

async function tryFeed(url: string): Promise<DiscoveredFeed | null> {
  try {
    const parsed = await parseFeed(url);
    return { url, title: stripNul(parsed.title ?? "").trim() || new URL(url).hostname };
  } catch {
    return null;
  }
}

/**
 * Finds the RSS/Atom feed for a site: the URL itself if it is a feed, then the
 * page's <link rel="alternate">, then a few conventional paths.
 */
export async function discoverFeed(input: string): Promise<DiscoveredFeed | null> {
  const direct = await tryFeed(input);
  if (direct) return direct;

  const candidates: string[] = [];
  try {
    const res = await fetch(input, {
      headers: { "User-Agent": "Mozilla/5.0 reading-room/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const { document } = parseHTML(await res.text());
      for (const link of document.querySelectorAll("link[rel~=alternate]")) {
        const type = link.getAttribute("type") ?? "";
        const href = link.getAttribute("href");
        if (href && /rss|atom|xml/.test(type)) candidates.push(new URL(href, res.url).toString());
      }
    }
  } catch {
    // Fall through to the conventional paths.
  }
  const origin = new URL(input).origin;
  candidates.push(...COMMON_FEED_PATHS.map((p) => origin + p));

  for (const url of [...new Set(candidates)]) {
    const found = await tryFeed(url);
    if (found) return found;
  }
  return null;
}
