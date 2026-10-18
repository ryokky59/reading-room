"use server";

import { asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { articles, feeds, folders, getDb } from "./db";
import { addUrl, discoverFeed, fetchAllFeeds, fetchFeed } from "./feeds";

export type ActionState = { message?: string; error?: string };

export async function fetchNow(): Promise<ActionState> {
  const { added, failedFeeds } = await fetchAllFeeds();
  revalidatePath("/");
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
  revalidatePath("/");
}

export async function restoreArticle(id: number) {
  const db = await getDb();
  await db.update(articles).set({ status: "inbox", readAt: null }).where(eq(articles.id, id));
  revalidatePath("/");
  revalidatePath("/read");
}

export async function markRead(id: number) {
  const db = await getDb();
  await db.update(articles).set({ status: "read", readAt: new Date() }).where(eq(articles.id, id));
  revalidatePath("/");
  revalidatePath("/read");
}

export async function updateNote(id: number, learning: string, memo: string) {
  const db = await getDb();
  await db
    .update(articles)
    .set({ learning: learning.trim(), memo: memo.trim() })
    .where(eq(articles.id, id));
  revalidatePath("/read");
  revalidatePath(`/articles/${id}`);
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

export async function setFeedEnabled(id: number, enabled: boolean) {
  const db = await getDb();
  await db.update(feeds).set({ enabled }).where(eq(feeds.id, id));
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
