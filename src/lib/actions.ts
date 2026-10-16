"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, checkPassword, createSessionToken, verifySessionToken } from "./auth";
import { articles, feeds, getDb } from "./db";
import { addUrl, discoverFeed, fetchAllFeeds, fetchFeed } from "./feeds";

export type ActionState = { message?: string; error?: string };

// Server actions can be invoked from any path, including /login which proxy
// leaves open, so each mutating action checks the session itself.
async function requireSession() {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) {
    throw new Error("unauthorized");
  }
}

export async function login(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await checkPassword(String(form.get("password") ?? "")))) {
    return { error: "パスワードが違います" };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function fetchNow(): Promise<ActionState> {
  await requireSession();
  const { added, failedFeeds } = await fetchAllFeeds();
  revalidatePath("/");
  const failed = failedFeeds.length ? `(取得失敗: ${failedFeeds.join("、")})` : "";
  return { message: `${added} 本の新着を追加しました${failed}` };
}

export async function addArticle(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const raw = String(form.get("url") ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
    if (!url.protocol.startsWith("http")) throw new Error();
  } catch {
    return { error: "URL の形式が正しくありません" };
  }
  const id = await addUrl(url.toString(), String(form.get("category") ?? "tech"));
  if (!id) return { error: "記事を追加できませんでした" };
  redirect(`/articles/${id}`);
}

export async function skipArticle(id: number) {
  await requireSession();
  const db = await getDb();
  await db.update(articles).set({ status: "skipped" }).where(eq(articles.id, id));
  revalidatePath("/");
}

export async function restoreArticle(id: number) {
  await requireSession();
  const db = await getDb();
  await db.update(articles).set({ status: "inbox", readAt: null }).where(eq(articles.id, id));
  revalidatePath("/");
  revalidatePath("/read");
}

export async function finishArticle(id: number, learning: string, memo: string) {
  await requireSession();
  const db = await getDb();
  await db
    .update(articles)
    .set({ status: "read", readAt: new Date(), learning: learning.trim(), memo: memo.trim() })
    .where(eq(articles.id, id));
  revalidatePath("/");
  revalidatePath("/read");
}

export async function updateNote(id: number, learning: string, memo: string) {
  await requireSession();
  const db = await getDb();
  await db
    .update(articles)
    .set({ learning: learning.trim(), memo: memo.trim() })
    .where(eq(articles.id, id));
  revalidatePath("/read");
  revalidatePath(`/articles/${id}`);
}

export async function addFeed(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const raw = String(form.get("url") ?? "").trim();
  const category = form.get("category") === "business" ? "business" : "tech";
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
    .values({ name, url: found.url, category })
    .onConflictDoNothing({ target: feeds.url })
    .returning({ id: feeds.id });
  if (!row) return { error: "このフィードはすでに登録されています" };

  const { added } = await fetchFeed(row.id);
  revalidatePath("/feeds");
  revalidatePath("/");
  return { message: `「${name}」を追加し、${added} 本を取り込みました` };
}

export async function setFeedEnabled(id: number, enabled: boolean) {
  await requireSession();
  const db = await getDb();
  await db.update(feeds).set({ enabled }).where(eq(feeds.id, id));
  revalidatePath("/feeds");
}

export async function deleteFeed(id: number) {
  await requireSession();
  const db = await getDb();
  // Articles already fetched from the feed stay.
  await db.delete(feeds).where(eq(feeds.id, id));
  revalidatePath("/feeds");
}
