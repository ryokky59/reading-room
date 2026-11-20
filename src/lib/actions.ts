"use server";

import { and, asc, eq, inArray, isNull, max, notInArray, or, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { articles, feeds, folders, getDb } from "./db";
import { addUrl, discoverFeed, fetchAllFeeds, fetchFeed } from "./feeds";
import { inboxOrder, inboxWhere, parseInboxFilter } from "./inbox";

export type ActionState = { message?: string; error?: string };

// Actions run from the inbox and article pages do not call revalidatePath; their callers call
// router.refresh() instead. A revalidating action answers with the page's route tree, and the
// router keeps that tree for later article navigations, together with the URL the list slot was
// last loaded from. Once a chip or 「もっと見る」 has changed the list beside an article, that
// URL is stale: the next revalidating action refetches the list from it, the trees no longer
// match, and the whole page reloads instead of opening the next article. router.refresh()
// refetches each slot from the URL it was loaded from and leaves no such tree behind.

/**
 * The first unread article in the inbox filter (`query` is its search string) that the list
 * has not loaded yet, i.e. the one behind 「もっと見る」; null when nothing unread is left there.
 */
export async function nextInboxArticle(query: string, loaded: number[]): Promise<number | null> {
  const filter = parseInboxFilter(Object.fromEntries(new URLSearchParams(query)));
  const ids = loaded.filter(Number.isInteger).slice(0, 1000);
  const db = await getDb();
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .leftJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(inboxWhere(filter), ids.length ? notInArray(articles.id, ids) : undefined))
    .orderBy(...inboxOrder)
    .limit(1);
  return row?.id ?? null;
}

export async function fetchNow(): Promise<ActionState> {
  const { added, failedFeeds } = await fetchAllFeeds();
  const failed = failedFeeds.length ? `(取得失敗: ${failedFeeds.join("、")})` : "";
  return { message: `${added} 本の新着を追加しました${failed}` };
}

export async function addArticle(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = String(form.get("url") ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
    if (!url.protocol.startsWith("http")) throw new Error();
  } catch {
    return { error: "URL の形式が正しくありません" };
  }
  // Articles added by URL have no feed, so they are unfiled (未分類).
  const id = await addUrl(url.toString());
  if (!id) return { error: "記事を追加できませんでした" };
  redirect(`/articles/${id}`);
}

export async function skipArticle(id: number) {
  const db = await getDb();
  await db.update(articles).set({ status: "skipped" }).where(eq(articles.id, id));
}

/** 「未読に戻す」 on a read or skipped article's page: back in the inbox, and unread. */
export async function restoreArticle(id: number) {
  const db = await getDb();
  await db.update(articles).set({ status: "inbox", readAt: null, seenAt: null }).where(eq(articles.id, id));
}

/**
 * The toast's 「元に戻す」 after 読了 / スキップ: back in the inbox as it was before, so an
 * article that was seen (既読) stays seen. Answers whether it is.
 */
export async function undoLeave(id: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .update(articles)
    .set({ status: "inbox", readAt: null })
    .where(eq(articles.id, id))
    .returning({ seenAt: articles.seenAt });
  return !!row?.seenAt;
}

/** Marks the unread articles `scope` picks as seen. */
async function setSeen(scope: SQL | undefined) {
  const db = await getDb();
  await db
    .update(articles)
    .set({ seenAt: new Date() })
    .where(and(eq(articles.status, "inbox"), isNull(articles.seenAt), scope));
}

export async function markSeen(ids: number[]) {
  const list = ids.filter(Number.isInteger).slice(0, 1000);
  if (list.length) await setSeen(inArray(articles.id, list));
}

export async function unmarkSeen(ids: number[]) {
  const list = ids.filter(Number.isInteger).slice(0, 1000);
  if (list.length === 0) return;
  const db = await getDb();
  await db
    .update(articles)
    .set({ seenAt: null })
    .where(and(eq(articles.status, "inbox"), inArray(articles.id, list)));
}

/** Everything unread from a feed; null is the articles with no feed (URL から追加). */
export async function markFeedSeen(feedId: number | null) {
  await setSeen(feedId === null ? isNull(articles.feedId) : eq(articles.feedId, feedId));
}

/** Everything unread in a folder; null is 未分類, which also holds the articles without a feed. */
export async function markFolderSeen(folderId: number | null) {
  const db = await getDb();
  const inFolder = db
    .select({ id: feeds.id })
    .from(feeds)
    .where(folderId === null ? isNull(feeds.folderId) : eq(feeds.folderId, folderId));
  await setSeen(
    folderId === null
      ? or(isNull(articles.feedId), inArray(articles.feedId, inFolder))
      : inArray(articles.feedId, inFolder),
  );
}

export async function markRead(id: number) {
  const db = await getDb();
  await db.update(articles).set({ status: "read", readAt: new Date() }).where(eq(articles.id, id));
}

export async function updateNote(id: number, learning: string, memo: string) {
  const db = await getDb();
  await db
    .update(articles)
    .set({ learning: learning.trim(), memo: memo.trim() })
    .where(eq(articles.id, id));
}

/** Reads a folder id from the form; null (未分類) when empty or unknown. */
async function folderFrom(form: FormData) {
  const id = Number(form.get("folderId"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = await getDb();
  const [row] = await db.select().from(folders).where(eq(folders.id, id));
  return row ?? null;
}

export async function addFeed(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = String(form.get("url") ?? "").trim();
  const folder = await folderFrom(form);
  try {
    if (!new URL(raw).protocol.startsWith("http")) throw new Error();
  } catch {
    return { error: "URL の形式が正しくありません" };
  }
  const found = await discoverFeed(raw);
  if (!found) return { error: "このサイトの RSS が見つかりませんでした。RSS の URL を直接入れてみてください" };

  const db = await getDb();
  const name = String(form.get("name") ?? "").trim() || found.title;
  const [row] = await db
    .insert(feeds)
    .values({ name, url: found.url, folderId: folder?.id ?? null })
    .onConflictDoNothing({ target: feeds.url })
    .returning({ id: feeds.id });
  if (!row) return { error: "このフィードはすでに登録されています" };

  const { added } = await fetchFeed(row.id);
  revalidatePath("/feeds");
  revalidatePath("/");
  return { message: `「${name}」を追加し、${added} 本を取り込みました` };
}

/** Stops or resumes fetching a site from its article page, which refreshes itself. */
export async function setArticleFeedEnabled(id: number, enabled: boolean) {
  const db = await getDb();
  await db.update(feeds).set({ enabled }).where(eq(feeds.id, id));
}

export async function setFeedEnabled(id: number, enabled: boolean) {
  await setArticleFeedEnabled(id, enabled);
  revalidatePath("/feeds");
}

export async function deleteFeed(id: number) {
  const db = await getDb();
  // Articles already fetched from the feed stay.
  await db.delete(feeds).where(eq(feeds.id, id));
  revalidatePath("/feeds");
}

export async function moveFeed(id: number, form: FormData) {
  const folder = await folderFrom(form);
  const db = await getDb();
  await db
    .update(feeds)
    .set({ folderId: folder?.id ?? null })
    .where(eq(feeds.id, id));
  revalidatePath("/feeds");
  revalidatePath("/");
}

export async function createFolder(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const db = await getDb();
  const [{ last }] = await db.select({ last: max(folders.position) }).from(folders);
  await db.insert(folders).values({ name, position: (last ?? -1) + 1 });
  revalidatePath("/feeds");
}

export async function renameFolder(id: number, form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const db = await getDb();
  await db.update(folders).set({ name }).where(eq(folders.id, id));
  revalidatePath("/feeds");
}

/** Swaps the folder with its neighbour above (-1) or below (+1). */
export async function moveFolder(id: number, step: -1 | 1) {
  const db = await getDb();
  const list = await db.select({ id: folders.id }).from(folders).orderBy(asc(folders.position), asc(folders.id));
  const i = list.findIndex((f) => f.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  // Rewrites every position so ties or gaps from older data cannot block a move.
  await Promise.all(list.map((f, position) => db.update(folders).set({ position }).where(eq(folders.id, f.id))));
  revalidatePath("/feeds");
}

export async function deleteFolder(id: number) {
  const db = await getDb();
  // Feeds in the folder become unfiled (未分類); they and their articles stay.
  await db.update(feeds).set({ folderId: null }).where(eq(feeds.folderId, id));
  await db.delete(folders).where(eq(folders.id, id));
  revalidatePath("/feeds");
}
