import { sideOverflows } from "./fits";
import { expect, test, type Page } from "./test";

// Stopping a site's fetching from the article page. Each width uses its own enabled feed,
// seeded at the end of e2e/seed.mts with two unread articles.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const siteNav = (page: Page) => page.getByRole("navigation", { name: "サイト" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const main = (page: Page) => page.getByRole("main");
const stopButton = (page: Page) => main(page).getByRole("button", { name: "このサイトの取得を止める" });
const confirmBox = (page: Page) => main(page).getByRole("group", { name: "取得を止める確認" });
const stoppedNote = (page: Page) => main(page).getByText("このサイトは取得を止めています");
const resumeButton = (page: Page) => main(page).getByRole("button", { name: "再開する" });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const chip = (label: string, count: number) =>
  new RegExp(`^${escape(label)}\\s*${count}$`);

/** Opens the folder's first article and returns its URL. */
async function openArticle(page: Page, folder: string) {
  await page.goto("/?a=1"); // Opening marks the article seen; it stays listed for the tests below.
  await folderNav(page).getByRole("link", { name: chip(folder, 2) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
  await card(page, `${folder}記事 1`).getByRole("link").first().click();
  await expect(heading(page)).toHaveText(`${folder}記事 1`);
  return page.url();
}

/**
 * On PCs a full load of an article fills the list beside it by passing through
 * `/articles/<id>/list`; waits until the list is in and the article URL is back.
 */
async function waitForListBeside(page: Page, url: string) {
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(url);
}

/** Stops the site from the article page, checking the confirmation and that the page stays. */
async function stopFromArticle(page: Page, site: string) {
  const url = page.url();
  await stopButton(page).click();
  await expect(confirmBox(page)).toContainText(`「${site}」の取得を止めますか? 未読の記事は残ります`);
  await confirmBox(page).getByRole("button", { name: "止める", exact: true }).click();
  await expect(stoppedNote(page)).toBeVisible();
  await expect(resumeButton(page)).toBeVisible();
  await expect(stopButton(page)).toHaveCount(0);
  expect(page.url()).toBe(url);
}

test.describe("PC 幅(3 ペイン)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("記事画面からサイトの取得を止めて再開でき、/feeds と状態がそろう", async ({ page }) => {
    const folder = "E2E PC で止める";
    const site = `${folder}サイト`;
    const articleUrl = await openArticle(page, folder);

    // "やめる" leaves everything as it was.
    await stopButton(page).click();
    await expect(confirmBox(page)).toBeVisible();
    expect(await sideOverflows(page)).toEqual([]);
    await confirmBox(page).getByRole("button", { name: "やめる" }).click();
    await expect(confirmBox(page)).toHaveCount(0);
    await expect(stopButton(page)).toBeVisible();
    await page.reload();
    await expect(stopButton(page)).toBeVisible();
    await waitForListBeside(page, articleUrl);

    await stopFromArticle(page, site);
    expect(await sideOverflows(page)).toEqual([]);
    await page.reload();
    await expect(stoppedNote(page)).toBeVisible();

    // The site's articles stay in the list beside the article, and so does its chip; the open
    // article is seen, so one is left unread.
    await expect(card(page, `${folder}記事 1`)).toBeVisible();
    await expect(card(page, `${folder}記事 2`)).toBeVisible();
    await expect(siteNav(page).getByRole("link", { name: chip(site, 1) })).toBeVisible();
    // The open article is seen, not read.
    await expect(main(page).getByRole("button", { name: "読了にする" })).toBeVisible();

    // /feeds shows the site as stopped; resuming there brings back the article's button.
    await page.goto("/feeds");
    const row = page.getByRole("region", { name: folder }).getByRole("listitem").filter({ hasText: site });
    await expect(row).toHaveClass(/opacity-50/);
    await row.getByRole("button", { name: "再開", exact: true }).click();
    await expect(row.getByRole("button", { name: "止める", exact: true })).toBeVisible();
    await page.goto(articleUrl);
    await expect(stopButton(page)).toBeVisible();
    await waitForListBeside(page, articleUrl);
    await expect(stoppedNote(page)).toHaveCount(0);

    // Resuming on the article page brings back the button too.
    await stopFromArticle(page, site);
    await resumeButton(page).click();
    await expect(stopButton(page)).toBeVisible();
    await expect(stoppedNote(page)).toHaveCount(0);
    await page.goto("/feeds");
    await expect(row.getByRole("button", { name: "止める", exact: true })).toBeVisible();
  });

  test("「URL を追加」で入れた記事にはボタンが出ない", async ({ page }) => {
    await page.goto("/?a=1");
    await card(page, "対話のある記事").getByRole("link").first().click();
    await expect(heading(page)).toHaveText("対話のある記事");
    await expect(main(page).getByRole("link", { name: "元記事を開く ↗" })).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
    await expect(stoppedNote(page)).toHaveCount(0);
  });
});

test.describe("スマホ幅 @mobile", () => {
  test("記事画面からサイトの取得を止めて再開でき、横にはみ出さない @mobile", async ({ page }) => {
    const folder = "E2E スマホで止める";
    const site = `${folder}サイト`;
    await openArticle(page, folder);
    expect(await sideOverflows(page)).toEqual([]);

    await stopButton(page).click();
    await expect(confirmBox(page)).toBeVisible();
    expect(await sideOverflows(page)).toEqual([]);
    await confirmBox(page).getByRole("button", { name: "やめる" }).click();
    await expect(stopButton(page)).toBeVisible();

    await stopFromArticle(page, site);
    expect(await sideOverflows(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "読了にする" })).toBeVisible();

    // Back in the list, the site's articles and its chip are still there; the opened one is seen.
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(card(page, `${folder}記事 1`)).toBeVisible();
    await expect(card(page, `${folder}記事 2`)).toBeVisible();
    await expect(siteNav(page).getByRole("link", { name: chip(site, 1) })).toBeVisible();

    await card(page, `${folder}記事 1`).getByRole("link").first().click();
    await expect(stoppedNote(page)).toBeVisible();
    await resumeButton(page).click();
    await expect(stopButton(page)).toBeVisible();
    expect(await sideOverflows(page)).toEqual([]);
  });
});
