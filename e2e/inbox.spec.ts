import { expect, test, type Locator, type Page } from "@playwright/test";
import { openFeed } from "./nav";

// Folder / site filter rows are seeded at the end of e2e/seed.mts.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const siteNav = (page: Page) => page.getByRole("navigation", { name: "サイト" });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A chip whose label is followed by its unread count. */
const chip = (nav: Locator, label: string, count: number | string = "\\d+") =>
  nav.getByRole("link", { name: new RegExp(`^${escape(label)}\\s*${count}$`) });
const cards = (page: Page) => page.getByRole("list", { name: "記事" }).getByRole("listitem");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("「既読を含む」でフォルダを選ぶとそのフォルダの記事だけになり、サイトが未読数つきで並ぶ", async ({ page }) => {
  await page.goto("/?a=1");
  await expect(chip(folderNav(page), "すべて")).toHaveAttribute("aria-current", "page");
  await expect(siteNav(page)).toHaveCount(0);

  await chip(folderNav(page), "Business").click();
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
  await expect(chip(folderNav(page), "Business")).toHaveAttribute("aria-current", "page");
  await expect(card(page, "ビジネスの記事")).toBeVisible();
  await expect(card(page, "速報の2本目")).toBeVisible();
  await expect(card(page, "週報の記事")).toBeVisible();
  await expect(card(page, "本番で動くエージェント")).toHaveCount(0);
  await expect(card(page, "量産記事 1")).toHaveCount(0);
  // Each card shows its folder instead of Tech / Business.
  await expect(card(page, "週報の記事")).toContainText("Business");

  await expect(chip(siteNav(page), "E2E ビジネス速報")).toBeVisible();
  await expect(chip(siteNav(page), "E2E ビジネス週報")).toBeVisible();
  // A site whose articles are all read gets no chip.
  await expect(siteNav(page).getByRole("link", { name: /E2E 読了だけのサイト/ })).toHaveCount(0);
});

test("サイトを選ぶとそのサイトの記事だけになる", async ({ page }) => {
  await page.goto("/?a=1"); // Opening marks the card seen; other tests open these.
  await chip(folderNav(page), "Business").click();
  await chip(siteNav(page), "E2E ビジネス速報").click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+&a=1$/);
  await expect(page.getByRole("heading", { name: "E2E ビジネス速報", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, "ビジネスの記事")).toBeVisible();
  await expect(card(page, "速報の2本目")).toBeVisible();
  await expect(card(page, "週報の記事")).toHaveCount(0);

  await page.getByRole("link", { name: "‹ ボード" }).click();
  await expect(page).toHaveURL("/");
  await expect(column(page, "E2E ビジネス週報")).toBeVisible();
});

test("記事を開いて戻っても、選んだフォルダ / サイトのまま", async ({ page }) => {
  await page.goto("/?a=1"); // Opening marks the card seen, and it is opened twice here.
  await chip(folderNav(page), "Business").click();
  await chip(siteNav(page), "E2E ビジネス速報").click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+&a=1$/);
  const filtered = page.url();

  // The back link in the article header.
  await card(page, "速報の2本目").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("速報の2本目");
  await expect(page.getByRole("main")).toContainText("Business");
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByRole("heading", { name: "E2E ビジネス速報", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  // The browser's back button.
  await card(page, "速報の2本目").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("速報の2本目");
  await page.goBack();
  await expect(page).toHaveURL(filtered);
  await expect(cards(page)).toHaveCount(2);
});

// Phones go back to the list; PCs open the next article instead (e2e/panes.spec.ts).
test("記事ページでスキップすると、選んでいたフォルダの一覧に戻る @mobile", async ({ page }) => {
  await page.goto("/");
  await chip(folderNav(page), "E2E 戻り先").click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  const filtered = page.url();
  await card(page, "戻り先の記事 1").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("戻り先の記事 1");
  await page.getByRole("button", { name: "スキップ" }).first().click();
  await expect(page).toHaveURL(filtered);
  await expect(card(page, "戻り先の記事 1")).toHaveCount(0);
  await expect(card(page, "戻り先の記事 2")).toBeVisible();
});

// Phones go back to the list; PCs open the next article instead (e2e/panes.spec.ts).
test("記事ページで読了にすると、選んでいたフォルダの一覧に戻る @mobile", async ({ page }) => {
  await page.goto("/");
  await chip(folderNav(page), "E2E 読了の戻り先").click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  const filtered = page.url();
  await card(page, "読了の戻り先 1").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("読了の戻り先 1");
  await page.getByRole("button", { name: "読了" }).first().click();
  await expect(page).toHaveURL(filtered);
  await expect(chip(folderNav(page), "E2E 読了の戻り先", 1)).toHaveAttribute("aria-current", "page");
  await expect(card(page, "読了の戻り先 1")).toHaveCount(0);
  await expect(card(page, "読了の戻り先 2")).toBeVisible();
});

test("サイトの最後の未読を読み終えると、そのフォルダのボードに戻る", async ({ page }) => {
  await openFeed(page, "E2E 読み終わり", "E2E 最後の1本のサイト");
  const folderUrl = page.url().replace(/&s=\d+$/, "");
  await card(page, "最後の1本").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("最後の1本");
  await page.getByRole("button", { name: "読了" }).first().click();
  // The site has nothing unread now, so its folder is shown instead of an empty list.
  await expect(page).toHaveURL(folderUrl);
  await expect(chip(folderNav(page), "E2E 読み終わり", 1)).toHaveAttribute("aria-current", "page");
  await expect(column(page, "E2E 最後の1本のサイト").getByRole("listitem")).toHaveText(["未読はありません"]);
  await expect(column(page, "E2E 残るサイト")).toContainText("残るサイトの記事");
});

test("「もっと見る」でも選んだフォルダが保たれる", async ({ page }) => {
  await page.goto("/?a=1"); // Keeps 35 cards once other tests have opened some of them.
  await chip(folderNav(page), "E2E たくさん").click();
  // Waits for the folder: すべて also shows 30 cards and its own 「もっと見る」.
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
  await expect(cards(page)).toHaveCount(30);
  await page.getByRole("link", { name: /もっと見る/ }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&n=60&a=1$/);
  await expect(cards(page)).toHaveCount(35);
  await expect(chip(folderNav(page), "E2E たくさん")).toHaveAttribute("aria-current", "page");
  await expect(card(page, "本番で動くエージェント")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /もっと見る/ })).toHaveCount(0);

  // Going back from an article keeps the longer list.
  const longer = page.url();
  await card(page, "量産記事 35").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("量産記事 35");
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(page).toHaveURL(longer);
  await expect(cards(page)).toHaveCount(35);
});

test("Tech / Business の固定表示がなく、フォルダ名か「未分類」が出る", async ({ page }) => {
  await page.goto("/?a=1"); // Keeps the article listed once another test has opened it.
  // Feedless articles are unfiled.
  const unfiled = card(page, "本番で動くエージェント");
  await expect(unfiled).toContainText("未分類");
  await expect(unfiled).not.toContainText("Tech");
  await page.getByRole("button", { name: "URL を追加" }).click();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("「未分類」に入ります")).toBeVisible();

  await page.goto("/read");
  const row = page.getByRole("listitem").filter({ hasText: "読了だけのサイトの記事" });
  await expect(row).toContainText("Business");
  await row.getByRole("link").click();
  await expect(page.getByRole("main")).toContainText("Business");
});

test("スマホ幅でチップが横スクロールでき、画面全体は横にはみ出さない @mobile", async ({ page }) => {
  await page.goto("/?a=1");
  const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await pageOverflow()).toBeLessThanOrEqual(0);

  const folders = folderNav(page).getByRole("list");
  const scrollable = (row: Locator) => row.evaluate((el) => el.scrollWidth > el.clientWidth);
  const scrollLeft = (row: Locator) => row.evaluate((el) => el.scrollLeft);
  expect(await scrollable(folders)).toBe(true);
  expect(await scrollLeft(folders)).toBe(0);
  // The last chip starts off screen; reaching it scrolls only the chip row.
  const last = chip(folderNav(page), "E2E 横スクロール確認用のフォルダ C");
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  expect(await scrollLeft(folders)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);

  await chip(folderNav(page), "E2E サイトの多いフォルダ").click();
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
  const sites = siteNav(page).getByRole("list");
  expect(await scrollable(sites)).toBe(true);
  const lastSite = chip(siteNav(page), "E2E 横に並ぶサイト 6", 1);
  await expect(lastSite).not.toBeInViewport();
  await lastSite.click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+&a=1$/);
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, "並ぶサイトの記事 6")).toBeVisible();
  expect(await pageOverflow()).toBeLessThanOrEqual(0);
});
