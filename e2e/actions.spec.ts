import { expect, test, type Page, type Request } from "@playwright/test";
import { openFeed, openTab } from "./nav";

// The owner's actions in the activity log (read, skip, undo, ...), sent once they are saved. As
// in e2e/activity.spec.ts, tests look at what the page sends. Folders are the 「E2E 操作 …」 ones
// in e2e/seed.mts, one per test: site A has A1–A4 unread, 「A 読了」 read and 「A 既読」 seen;
// site B has B1 and B2 unread.

type Sent = Record<string, unknown>;

const isActivity = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/activity";
const parse = (r: Request): Sent => JSON.parse(r.postData() ?? "null");
/** Collects every event the page sends from now on. */
function recordActivity(page: Page) {
  const sent: Sent[] = [];
  page.on("request", (r) => {
    if (isActivity(r)) sent.push(parse(r));
  });
  return sent;
}
/** The next event of `type` the page sends. */
const next = (page: Page, type: string) =>
  page.waitForRequest((r) => isActivity(r) && parse(r).type === type).then(parse);

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const list = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
/** The article id a list card links to. */
const cardId = async (page: Page, title: string) =>
  Number(/\/articles\/(\d+)/.exec((await card(page, title).getByRole("link").first().getAttribute("href"))!)![1]);
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** The feed id a Board column's heading links to (`?f=<folder>&s=<feed>`). */
const columnFeedId = async (page: Page, name: string) =>
  Number(
    /[?&]s=(\d+)/.exec((await column(page, name).getByRole("heading", { level: 3 }).getByRole("link").getAttribute("href"))!)![1],
  );
const toast = (page: Page) => page.getByRole("status");
const undo = (page: Page) => toast(page).getByRole("button", { name: "元に戻す" });
const markAll = (page: Page) => page.getByRole("button", { name: "すべて既読" });
const failed = (page: Page) => page.getByText("保存できませんでした。もう一度押してください");
const errorPage = (page: Page) => page.getByText("This page couldn't load");

/** Opens the article from its feed's list and returns its `open`. */
async function openArticle(page: Page, title: string) {
  const open = next(page, "open");
  await card(page, title).getByRole("link").click();
  await expect(heading(page)).toHaveText(title);
  return open;
}

/** Waits a little and returns the events of `type` sent meanwhile and before. */
async function settled(sent: Sent[], type: string) {
  await new Promise((r) => setTimeout(r, 500));
  return sent.filter((e) => e.type === type);
}

/** 元記事を開く opens example.com in a new tab; it is answered here, never by the network. */
async function stubOriginal(page: Page) {
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>元記事</p>" }),
  );
}

test.describe("PC 幅", () => {
  test("記事の「読了にする」は via=button、e は via=key、s は screen=article の skip。元に戻すは of 付き", async ({ page }) => {
    const folder = "E2E 操作 記事";
    await openFeed(page, folder, `${folder} A`);
    const first = await openArticle(page, `${folder} A1`);

    let read = next(page, "read");
    let open = next(page, "open");
    await page.getByRole("button", { name: "読了にする" }).click();
    expect(await read).toMatchObject({
      type: "read",
      screen: "article",
      articleId: first.articleId,
      viewId: first.viewId,
      device: "pc",
      layout: "split",
      props: { via: "button" },
    });
    const second = await open;
    await expect(heading(page)).toHaveText(`${folder} A2`);

    // The toast's 元に戻す says what it undid.
    const undone = next(page, "undo");
    await undo(page).click();
    expect(await undone).toMatchObject({ type: "undo", articleId: first.articleId, viewId: null, props: { of: "read" } });
    await expect(card(page, `${folder} A1`)).toBeVisible();

    read = next(page, "read");
    open = next(page, "open");
    await page.keyboard.press("e");
    expect(await read).toMatchObject({
      screen: "article",
      articleId: second.articleId,
      viewId: second.viewId,
      props: { via: "key" },
    });
    const third = await open;
    await expect(heading(page)).not.toHaveText(`${folder} A2`);

    const skip = next(page, "skip");
    await page.keyboard.press("s");
    expect(await skip).toMatchObject({
      type: "skip",
      screen: "article",
      articleId: third.articleId,
      viewId: third.viewId,
      props: { via: "key" },
    });
    const skipUndone = next(page, "undo");
    await undo(page).click();
    expect(await skipUndone).toMatchObject({ articleId: third.articleId, props: { of: "skip" } });
  });

  test("一覧のカードのスキップは screen=list で view_id なし。開いている記事のカードでも同じ。未読に戻すは unsee", async ({ page }) => {
    const folder = "E2E 操作 カード";
    await openFeed(page, folder, `${folder} A`);
    const a1 = await cardId(page, `${folder} A1`);

    let skip = next(page, "skip");
    await card(page, `${folder} A1`).getByRole("button", { name: "スキップ" }).click();
    expect(await skip).toMatchObject({
      type: "skip",
      screen: "list",
      articleId: a1,
      viewId: null,
      device: "pc",
      props: { via: "button" },
    });
    await expect(card(page, `${folder} A1`)).toHaveCount(0);
    const undone = next(page, "undo");
    await undo(page).click();
    expect(await undone).toMatchObject({ screen: "list", articleId: a1, props: { of: "skip" } });
    await expect(card(page, `${folder} A1`)).toBeVisible();

    // 未読に戻す on a seen card.
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(page).toHaveURL(/&a=1$/);
    const seen = await cardId(page, `${folder} A 既読`);
    const unsee = next(page, "unsee");
    await card(page, `${folder} A 既読`).getByRole("button", { name: "未読に戻す" }).click();
    expect(await unsee).toMatchObject({ type: "unsee", screen: "list", articleId: seen, viewId: null });
    await expect(card(page, `${folder} A 既読`).getByRole("button", { name: "未読に戻す" })).toHaveCount(0);

    // Beside the open article the URL says `article`, but the card is in the list, and skipping
    // it there is not a step of the article's view.
    const opened = await openArticle(page, `${folder} A2`);
    skip = next(page, "skip");
    await card(page, `${folder} A2`).getByRole("button", { name: "スキップ" }).click();
    expect(await skip).toMatchObject({ screen: "list", articleId: opened.articleId, viewId: null });
  });

  test("ボードの列・フォルダの「すべて既読」は screen=board で feedId / folderId 付き", async ({ page }) => {
    const folder = "E2E 操作 ボード";
    await openTab(page, folder);
    const folderId = Number(/[?&]f=(\d+)/.exec(page.url())![1]);
    const feedA = await columnFeedId(page, `${folder} A`);

    let seen = next(page, "seen_all");
    await column(page, `${folder} A`).getByRole("button", { name: "すべて既読" }).click();
    const sent = await seen;
    expect(sent).toMatchObject({ type: "seen_all", screen: "board", props: { feedId: feedA }, viewId: null });
    expect(sent.articleId).toBeUndefined();
    await expect(column(page, `${folder} A`).getByLabel("未読 0 本")).toBeVisible();

    // The folder's button comes before the columns' own.
    seen = next(page, "seen_all");
    await markAll(page).first().click();
    expect(await seen).toMatchObject({ screen: "board", props: { folderId } });
    await expect(page.getByText("未読の記事はありません。", { exact: false })).toBeVisible();
  });

  test("一覧の「すべて既読」は screen=list で feedId 付き。記事の横の一覧でも screen=list", async ({ page }) => {
    const folder = "E2E 操作 一覧";
    await openTab(page, folder);
    const feedA = await columnFeedId(page, `${folder} A`);
    const feedB = await columnFeedId(page, `${folder} B`);

    await openFeed(page, folder, `${folder} A`);
    let seen = next(page, "seen_all");
    await markAll(page).click();
    expect(await seen).toMatchObject({ screen: "list", props: { feedId: feedA } });
    // The site has nothing left, so its folder's Board is shown.
    await expect(page).toHaveURL(/\/\?f=\d+$/);

    await openFeed(page, folder, `${folder} B`);
    await openArticle(page, `${folder} B1`);
    seen = next(page, "seen_all");
    await markAll(page).click();
    const beside = await seen;
    expect(beside).toMatchObject({ screen: "list", props: { feedId: feedB }, viewId: null });
    expect(beside.articleId).toBeUndefined();
  });

  test("要約・質問の送信は kind 付きの chat で本文なし。元記事を開く・取得の停止と再開・未読に戻すも送られる", async ({ page }) => {
    // The chat is answered here; the AI is never called.
    await page.route("**/api/articles/*/chat", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "スタブの応答です。" }),
    );
    await stubOriginal(page);
    const folder = "E2E 操作 AI";
    await openFeed(page, folder, `${folder} A`);
    const feedId = Number(/[?&]s=(\d+)/.exec(page.url())![1]);
    const opened = await openArticle(page, `${folder} A1`);
    const view = { articleId: opened.articleId, viewId: opened.viewId, screen: "article" };

    const chat = next(page, "chat");
    await page.getByRole("button", { name: "要約してもらう" }).click();
    expect(await chat).toMatchObject({ ...view, type: "chat", props: { kind: "summary" } });
    await expect(page.getByText("スタブの応答です。")).toBeVisible();

    const question = "これは記録に残らない質問です";
    const request = page.waitForRequest((r) => isActivity(r) && parse(r).type === "chat");
    await page.getByPlaceholder("質問や感想を書く").fill(question);
    await page.getByRole("button", { name: "送信" }).click();
    const sent = await request;
    expect(parse(sent)).toMatchObject({ ...view, props: { kind: "message" } });
    expect(sent.postData()).not.toContain(question);
    await expect(page.getByText(question)).toBeVisible();

    const original = next(page, "original");
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "元記事を開く ↗" }).click();
    expect(await original).toMatchObject({ ...view, type: "original" });
    await (await popup).close();

    const pause = next(page, "feed_pause");
    await page.getByRole("button", { name: "このサイトの取得を止める" }).click();
    await page.getByRole("button", { name: "止める", exact: true }).click();
    expect(await pause).toMatchObject({ ...view, type: "feed_pause", props: { feedId } });
    await expect(page.getByText("このサイトは取得を止めています")).toBeVisible();
    const resume = next(page, "feed_resume");
    await page.getByRole("button", { name: "再開する" }).click();
    expect(await resume).toMatchObject({ ...view, type: "feed_resume", props: { feedId } });
    await expect(page.getByRole("button", { name: "このサイトの取得を止める" })).toBeVisible();

    // 未読に戻す on a read article.
    await page.goto("/read");
    const readOpen = next(page, "open");
    await page.getByRole("link", { name: new RegExp(`${folder} A 読了`) }).click();
    await expect(heading(page)).toHaveText(`${folder} A 読了`);
    const readView = await readOpen;
    const restore = next(page, "restore");
    await page.getByRole("button", { name: "未読に戻す" }).click();
    expect(await restore).toMatchObject({
      type: "restore",
      screen: "article",
      articleId: readView.articleId,
      viewId: readView.viewId,
    });
    await expect(heading(page)).toHaveCount(0);
  });

  test("保存に失敗するとイベントは送られず、メッセージが出て、もう一度押せば送られる", async ({ page }) => {
    const folder = "E2E 操作 失敗";
    await openFeed(page, folder, `${folder} A`);
    const opened = await openArticle(page, `${folder} A1`);
    const sent = recordActivity(page);
    await page.route("**/*", (route) =>
      "next-action" in route.request().headers() ? route.abort() : route.fallback(),
    );

    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" })).toBeVisible();
    await expect(heading(page)).toHaveText(`${folder} A1`);
    // A card in the list beside it.
    await card(page, `${folder} A2`).getByRole("button", { name: "スキップ" }).click();
    await expect(toast(page)).toHaveText(/保存できませんでした。もう一度押してください/);
    await expect(card(page, `${folder} A2`)).toBeVisible();
    expect(await settled(sent, "read")).toHaveLength(0);
    expect(await settled(sent, "skip")).toHaveLength(0);
    await expect(errorPage(page)).toHaveCount(0);

    await page.unrouteAll();
    const read = next(page, "read");
    await page.getByRole("button", { name: "読了にする" }).click();
    expect(await read).toMatchObject({ articleId: opened.articleId, viewId: opened.viewId, props: { via: "button" } });
    await expect(heading(page)).not.toHaveText(`${folder} A1`);
    expect(await settled(sent, "read")).toHaveLength(1);
  });

  test("/api/activity を遮断しても、すべての操作がふだんどおり保存され、エラーが出ない", async ({ page }) => {
    const blocked: string[] = [];
    await page.route("**/api/activity", (route) => {
      blocked.push(String(JSON.parse(route.request().postData() ?? "{}").type));
      return route.abort();
    });
    await page.route("**/api/articles/*/chat", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "スタブの応答です。" }),
    );
    await stubOriginal(page);
    const folder = "E2E 操作 遮断";
    await openFeed(page, folder, `${folder} A`);

    // A card's スキップ and its 元に戻す, and 未読に戻す on a seen card.
    await card(page, `${folder} A1`).getByRole("button", { name: "スキップ" }).click();
    await expect(card(page, `${folder} A1`)).toHaveCount(0);
    await undo(page).click();
    await expect(card(page, `${folder} A1`)).toBeVisible();
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await card(page, `${folder} A 既読`).getByRole("button", { name: "未読に戻す" }).click();
    await expect(card(page, `${folder} A 既読`).getByRole("button", { name: "未読に戻す" })).toHaveCount(0);
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(page).not.toHaveURL(/&a=1$/);

    // In the article: the AI, 元記事を開く, the site's fetching, 読了 and スキップ.
    await card(page, `${folder} A1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} A1`);
    await page.getByRole("button", { name: "要約してもらう" }).click();
    await expect(page.getByText("スタブの応答です。")).toBeVisible();
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "元記事を開く ↗" }).click();
    await (await popup).close();
    await page.getByRole("button", { name: "このサイトの取得を止める" }).click();
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(page.getByText("このサイトは取得を止めています")).toBeVisible();
    await page.getByRole("button", { name: "再開する" }).click();
    await expect(page.getByRole("button", { name: "このサイトの取得を止める" })).toBeVisible();
    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).not.toHaveText(`${folder} A1`);
    await expect(toast(page)).toHaveText(/読了にしました/);
    await page.getByRole("main").getByRole("button", { name: "スキップ", exact: true }).click();
    await expect(toast(page)).toHaveText(/スキップしました/);

    // 未読に戻す on a read article, then すべて既読 in the list.
    await page.goto("/read");
    await page.getByRole("link", { name: new RegExp(`${folder} A 読了`) }).click();
    await expect(heading(page)).toHaveText(`${folder} A 読了`);
    await page.getByRole("button", { name: "未読に戻す" }).click();
    await expect(heading(page)).toHaveCount(0);
    await openFeed(page, folder, `${folder} B`);
    await markAll(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);

    for (const type of ["skip", "undo", "unsee", "chat", "original", "feed_pause", "feed_resume", "read", "restore", "seen_all"]) {
      await expect.poll(() => blocked, type).toContain(type);
    }
    await expect(failed(page)).toHaveCount(0);
    await expect(errorPage(page)).toHaveCount(0);
  });
});

test("スマホ: 一覧のカードのスキップは screen=list、記事の中なら screen=article。元に戻すも送られる @mobile", async ({ page }) => {
  const folder = "E2E 操作 スマホ";
  await openFeed(page, folder, `${folder} A`);
  const a1 = await cardId(page, `${folder} A1`);

  let skip = next(page, "skip");
  await card(page, `${folder} A1`).getByRole("button", { name: "スキップ" }).click();
  expect(await skip).toMatchObject({
    screen: "list",
    articleId: a1,
    viewId: null,
    device: "phone",
    layout: "single",
    props: { via: "button" },
  });
  await expect(card(page, `${folder} A1`)).toHaveCount(0);

  const opened = await openArticle(page, `${folder} A2`);
  skip = next(page, "skip");
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  expect(await skip).toMatchObject({
    screen: "article",
    articleId: opened.articleId,
    viewId: opened.viewId,
    device: "phone",
    props: { via: "button" },
  });
  await expect(heading(page)).toHaveCount(0);
  const undone = next(page, "undo");
  await undo(page).click();
  expect(await undone).toMatchObject({ screen: "list", articleId: opened.articleId, props: { of: "skip" } });
  await expect(card(page, `${folder} A2`)).toBeVisible();
});
