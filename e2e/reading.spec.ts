import { expect, test, type Page, type Request } from "@playwright/test";
import { openFeed } from "./nav";

// `leave` in the activity log (src/components/useReadingLog.ts): the time spent on an article and
// how far down it was read. As in e2e/activity.spec.ts, tests look at what the page sends.
// Folders are the 「E2E 滞在 …」 ones in e2e/seed.mts, one per test, each with 3 unread articles
// whose body is long enough to scroll.

type Sent = Record<string, unknown> & { dwellMs?: number; scrollPct?: number };

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
const leaves = (sent: Sent[]) => sent.filter((e) => e.type === "leave");
/** The next event of `type` the page sends. */
const next = (page: Page, type: string) =>
  page.waitForRequest((r) => isActivity(r) && parse(r).type === type).then(parse);
const openId = (page: Page) => Number(/\/articles\/(\d+)/.exec(page.url())![1]);

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const list = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const article = (page: Page) => page.getByRole("main");
const back = (page: Page) => page.getByRole("link", { name: "戻る", exact: true });

/** Opens the article from its feed's list and returns its `open`. */
async function openArticle(page: Page, title: string) {
  const open = next(page, "open");
  await card(page, title).getByRole("link").click();
  await expect(heading(page)).toHaveText(title);
  return open;
}

/** Plays the tab being hidden or shown again; Chromium cannot hide it from a test. */
const setVisibility = (page: Page, state: "visible" | "hidden") =>
  page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

test.describe("PC 幅", () => {
  test("開いて時間を進めてから一覧に戻ると、open と同じ view_id の leave が進めた時間で送られる", async ({ page }) => {
    await page.clock.install();
    const folder = "E2E 滞在 時間";
    await openFeed(page, folder);
    const opened = await openArticle(page, `${folder} 1`);
    await page.clock.fastForward(60_000);

    const leave = next(page, "leave");
    await back(page).click();
    await expect(heading(page)).toHaveCount(0);
    const left = await leave;
    expect(left).toMatchObject({
      type: "leave",
      screen: "article",
      articleId: opened.articleId,
      viewId: opened.viewId,
      device: "pc",
      layout: "split",
      props: { body_lang: "original" },
    });
    // The minute moved on, plus the few real seconds the test took.
    expect(left.dwellMs).toBeGreaterThanOrEqual(60_000);
    expect(left.dwellMs).toBeLessThan(70_000);
    expect(left.activeMs).toBeLessThanOrEqual(left.dwellMs!);
  });

  test("タブが隠れている間は dwell_ms が進まず、隠れた時と離れた時に累積値の leave が送られる", async ({ page }) => {
    await page.clock.install();
    const folder = "E2E 滞在 隠す";
    await openFeed(page, folder);
    const opened = await openArticle(page, `${folder} 1`);
    const sent = recordActivity(page);
    await page.clock.fastForward(10_000);

    let leave = next(page, "leave");
    await setVisibility(page, "hidden");
    const hidden = await leave;
    expect(hidden).toMatchObject({ articleId: opened.articleId, viewId: opened.viewId, screen: "article" });
    expect(hidden.dwellMs).toBeGreaterThanOrEqual(10_000);
    expect(hidden.dwellMs).toBeLessThan(20_000);

    // A minute in the background does not count.
    await page.clock.fastForward(60_000);
    await setVisibility(page, "visible");
    await page.clock.fastForward(5_000);
    leave = next(page, "leave");
    await back(page).click();
    const left = await leave;
    expect(left).toMatchObject({ articleId: opened.articleId, viewId: opened.viewId, screen: "article" });
    expect(left.dwellMs).toBeGreaterThanOrEqual(hidden.dwellMs! + 5_000);
    expect(left.dwellMs).toBeLessThan(hidden.dwellMs! + 15_000);

    await new Promise((r) => setTimeout(r, 500));
    expect(leaves(sent)).toHaveLength(2);
  });

  test("記事のペインを途中までスクロールすると scroll_pct が 0 と 100 の間、最後までで 100 になる", async ({ page }) => {
    const folder = "E2E 滞在 PC";
    await openFeed(page, folder);
    const first = await openArticle(page, `${folder} 1`);
    await article(page).hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => article(page).evaluate((m) => m.getBoundingClientRect().top)).toBeLessThan(-1000);

    // Another article from the list beside it: the first one's leave, then the second's open.
    let leave = next(page, "leave");
    const second = await openArticle(page, `${folder} 2`);
    const half = await leave;
    expect(half).toMatchObject({ articleId: first.articleId, viewId: first.viewId });
    expect(half.scrollPct).toBeGreaterThan(0);
    expect(half.scrollPct).toBeLessThan(100);

    await article(page).hover();
    await page.mouse.wheel(0, 100_000);
    await expect(page.getByRole("button", { name: "読了にする" })).toBeInViewport();
    leave = next(page, "leave");
    await back(page).click();
    expect(await leave).toMatchObject({ articleId: second.articleId, viewId: second.viewId, scrollPct: 100 });
  });

  test("読了して次の記事が開くと、前の記事の leave と次の記事の open がそれぞれの id で送られる", async ({ page }) => {
    const folder = "E2E 滞在 次へ";
    await openFeed(page, folder);
    const first = await openArticle(page, `${folder} 1`);
    const sent = recordActivity(page);
    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect.poll(() => sent.map((e) => e.type)).toEqual(["leave", "open"]);
    expect(sent[0]).toMatchObject({ articleId: first.articleId, viewId: first.viewId, screen: "article" });
    expect(sent[1]).toMatchObject({ articleId: openId(page), source: "next" });
    expect(sent[1].viewId).not.toBe(first.viewId);
  });

  test("/api/activity を遮断しても、スクロール・読了・戻るがふだんどおり動き、エラーが出ない", async ({ page }) => {
    const blocked: string[] = [];
    await page.route("**/api/activity", (route) => {
      blocked.push(String(JSON.parse(route.request().postData() ?? "{}").type));
      return route.abort();
    });
    const folder = "E2E 滞在 遮断";
    await openFeed(page, folder);
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await article(page).hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => article(page).evaluate((m) => m.getBoundingClientRect().top)).toBeLessThan(-1000);

    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(page.getByRole("status")).toHaveText(/読了にしました/);
    await back(page).click();
    await expect(heading(page)).toHaveCount(0);
    await expect(card(page, `${folder} 2`)).toBeVisible();
    await expect.poll(() => blocked.filter((t) => t === "leave")).toHaveLength(2);

    await expect(page.getByText("保存できませんでした")).toHaveCount(0);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  });
});

test("スマホで window をスクロールすると scroll_pct が 0 と 100 の間、最後までで 100 になる @mobile", async ({ page }) => {
  const folder = "E2E 滞在 スマホ";
  await openFeed(page, folder);
  const first = await openArticle(page, `${folder} 1`);
  await page.evaluate(() => scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1000);
  let leave = next(page, "leave");
  await back(page).click();
  await expect(heading(page)).toHaveCount(0);
  const half = await leave;
  expect(half).toMatchObject({ articleId: first.articleId, viewId: first.viewId, device: "phone", layout: "single" });
  expect(half.scrollPct).toBeGreaterThan(0);
  expect(half.scrollPct).toBeLessThan(100);

  const second = await openArticle(page, `${folder} 2`);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByText("長い本文の段落 60 です。")).toBeInViewport();
  // Browser back leaves too.
  leave = next(page, "leave");
  await page.goBack();
  await expect(heading(page)).toHaveCount(0);
  expect(await leave).toMatchObject({ articleId: second.articleId, viewId: second.viewId, scrollPct: 100 });
});
