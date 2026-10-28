import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";
import { digestArticle, type Digest } from "./ai";
import { articles, feeds, getDb, type Feed } from "./db";
import { EMPTY, extractArticle } from "./extract";

type Candidate = {
  url: string;
  title: string;
  source: string;
  feedId: number | null; // null for articles added by URL
  publishedAt: Date | null;
  summary: string | null;
};

export type FetchResult = { added: number; failedFeeds: string[] };

const parser = new Parser({ timeout: 15_000, headers: { "User-Agent": "reading-room/1.0" } });

async function collect(feed: Feed): Promise<Candidate[]> {
  const since = Date.now() - feed.days * 86_400_000;
  // Feed hosts time out now and then; one retry clears most of it.
  const parsed = await parser.parseURL(feed.url).catch(() => parser.parseURL(feed.url));
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

async function save(candidates: Candidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
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
    const ex = await extractArticle(c.url).catch((err) => {
      console.error("extract failed", c.url, err);
      return EMPTY;
    });
    const title = c.title !== "(無題)" ? c.title : (ex.title ?? c.title);
    const excerpt = ex.excerpt ?? c.summary;
    const digest = await tryDigest({ title, text: ex.text, excerpt });
    return {
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
    };
  });
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(articles)
    .values(rows)
    .onConflictDoNothing({ target: articles.url })
    .returning({ id: articles.id });
  return inserted.length;
}

async function tryDigest(a: Parameters<typeof digestArticle>[0]): Promise<Partial<Digest>> {
  try {
    return await digestArticle(a);
  } catch (err) {
    console.error("digest failed", a.title, err);
    return {};
  }
}

/** Fills in the AI title/summary for unread articles that don't have one yet. */
async function digestMissing(limit: number): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ id: articles.id, title: articles.title, text: articles.contentText, excerpt: articles.excerpt })
    .from(articles)
    .where(and(eq(articles.status, "inbox"), isNull(articles.summary)))
    .orderBy(desc(articles.fetchedAt))
    .limit(limit);
  await mapLimit(rows, 6, async (r) => {
    const digest = await tryDigest(r);
    if (digest.summary) await db.update(articles).set(digest).where(eq(articles.id, r.id));
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
          .set({ lastFetchedAt: new Date(), lastError: String(err instanceof Error ? err.message : err).slice(0, 200) })
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
    const parsed = await parser.parseURL(url);
    return { url, title: parsed.title?.trim() || new URL(url).hostname };
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
