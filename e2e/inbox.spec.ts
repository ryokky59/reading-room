import { expect, test, type Locator, type Page } from "@playwright/test";

// Folder / site filter rows are seeded at the end of e2e/seed.mts.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const siteNav = (page: Page) => page.getByRole("navigation", { name: "サイト" });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A chip whose label is followed by its unread count. */
const chip = (nav: Locator, label: string, count: number | string = "\\d+") =>
  nav.getByRole("link", { name: new RegExp(`^${escape(label)}\\s*${count}$`) });
const cards = (page: Page) => page.getByRole("list", { name: "記事" }).getByRole("listitem");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });

test("フォルダを選ぶとそのフォルダの記事だけになり、サイトが未読数つきで並ぶ", async ({ page }) => {
  await page.goto("/");
  await expect(chip(folderNav(page), "すべて")).toHaveAttribute("aria-current", "page");
  await expect(siteNav(page)).toHaveCount(0);

  await chip(folderNav(page), "Business").click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(chip(folderNav(page), "Business")).toHaveAttribute("aria-current", "page");
  await expect(card(page, "ビジネスの記事")).toBeVisible();
  await expect(card(page, "速報の2本目")).toBeVisible();
  await expect(card(page, "週報の記事")).toBeVisible();
  await expect(card(page, "本番で動くエージェント")).toHaveCount(0);
  await expect(card(page, "量産記事 1")).toHaveCount(0);
  // Each card shows its folder instead of Tech / Business.
  await expect(card(page, "週報の記事")).toContainText("Business");

  await expect(chip(siteNav(page), "E2E ビジネス速報", 2)).toBeVisible();
  await expect(chip(siteNav(page), "E2E ビジネス週報", 1)).toBeVisible();
  // A site whose articles are all read gets no chip.
  await expect(siteNav(page).getByRole("link", { name: /E2E 既読だけのサイト/ })).toHaveCount(0);
});

test("サイトを選ぶとそのサイトの記事だけになる", async ({ page }) => {
  await page.goto("/");
  await chip(folderNav(page), "Business").click();
  await chip(siteNav(page), "E2E ビジネス速報", 2).click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
  await expect(chip(siteNav(page), "E2E ビジネス速報", 2)).toHaveAttribute("aria-current", "page");
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, "ビジネスの記事")).toBeVisible();
  await expect(card(page, "速報の2本目")).toBeVisible();
  await expect(card(page, "週報の記事")).toHaveCount(0);

  await siteNav(page).getByRole("link", { name: "このフォルダすべて" }).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(card(page, "週報の記事")).toBeVisible();
});

test("記事を開いて戻っても、選んだフォルダ / サイトのまま", async ({ page }) => {
  await page.goto("/");
  await chip(folderNav(page), "Business").click();
  await chip(siteNav(page), "E2E ビジネス速報").click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
  const filtered = page.url();

  // The back link in the article header.
  await card(page, "速報の2本目").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("速報の2本目");
  await expect(page.getByRole("main")).toContainText("Business");
  await page.getByRole("link", { name: "戻る" }).click();
  await expect(page).toHaveURL(filtered);
  await expect(chip(siteNav(page), "E2E ビジネス速報")).toHaveAttribute("aria-current", "page");
  await expect(cards(page)).toHaveCount(2);

  // The browser's back button.
  await card(page, "速報の2本目").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("速報の2本目");
  await page.goBack();
  await expect(page).toHaveURL(filtered);
  await expect(cards(page)).toHaveCount(2);
});

test("記事ページでスキップすると、選んでいたフォルダの一覧に戻る", async ({ page }) => {
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

test("「もっと見る」でも選んだフォルダが保たれる", async ({ page }) => {
  await page.goto("/");
  await chip(folderNav(page), "E2E たくさん", 35).click();
  await expect(cards(page)).toHaveCount(30);
  await page.getByRole("link", { name: /もっと見る/ }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&n=60$/);
  await expect(cards(page)).toHaveCount(35);
  await expect(chip(folderNav(page), "E2E たくさん", 35)).toHaveAttribute("aria-current", "page");
  await expect(card(page, "本番で動くエージェント")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /もっと見る/ })).toHaveCount(0);
});

test("Tech / Business の固定表示がなく、フォルダ名か「未分類」が出る", async ({ page }) => {
  await page.goto("/");
  // Feedless articles are unfiled.
  const unfiled = card(page, "本番で動くエージェント");
  await expect(unfiled).toContainText("未分類");
  await expect(unfiled).not.toContainText("Tech");
  await page.getByRole("button", { name: "URL を追加" }).click();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("「未分類」に入ります")).toBeVisible();

  await page.goto("/read");
  const row = page.getByRole("listitem").filter({ hasText: "既読だけのサイトの記事" });
  await expect(row).toContainText("Business");
  await row.getByRole("link").click();
  await expect(page.getByRole("main")).toContainText("Business");
});

test("スマホ幅でチップが横スクロールでき、画面全体は横にはみ出さない @mobile", async ({ page }) => {
  await page.goto("/");
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
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  const sites = siteNav(page).getByRole("list");
  expect(await scrollable(sites)).toBe(true);
  const lastSite = chip(siteNav(page), "E2E 横に並ぶサイト 6", 1);
  await expect(lastSite).not.toBeInViewport();
  await lastSite.click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, "並ぶサイトの記事 6")).toBeVisible();
  expect(await pageOverflow()).toBeLessThanOrEqual(0);
});
