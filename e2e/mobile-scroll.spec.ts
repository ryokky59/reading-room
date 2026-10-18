import { expect, test, type Page } from "@playwright/test";

// Phones show the list and the article one at a time on the same window scroll: coming back
// from an article puts the list where it was, and an article always starts at its top.
// Each test uses its own folder from the end of e2e/seed.mts, with 20 long articles.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/** Opens the folder, scrolls the list well down and opens its 12th article after scrolling it. */
async function openFromScrolledList(page: Page, folder: string) {
  await page.goto("/");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${folder}\\s*\\d+$`) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(list(page).getByRole("listitem")).toHaveCount(20);

  await card(page, `${folder} 12`).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  const listY = await scrollY(page);
  expect(listY).toBeGreaterThan(500);

  await card(page, `${folder} 12`).getByRole("link").first().click();
  await expect(heading(page)).toHaveText(`${folder} 12`);
  await expect(page.getByText("長い本文の段落 60 です。")).toBeAttached();
  // The article starts at its top, not at the list's position.
  await expect.poll(() => scrollY(page)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(() => scrollY(page)).toBeGreaterThan(1500);
  return listY;
}

async function expectListAt(page: Page, y: number, tolerance: number) {
  await expect(list(page)).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(tolerance);
}

test.describe("スマホ幅で記事から一覧に戻る @mobile", () => {
  test("← で戻ると一覧の元の位置に戻り、次に開いた記事も先頭から表示される @mobile", async ({ page }) => {
    const folder = "E2E スマホの矢印";
    const listY = await openFromScrolledList(page, folder);

    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expectListAt(page, listY, 2);

    // Opening another article from the restored list starts it at the top again.
    await card(page, `${folder} 14`).getByRole("link").first().click();
    await expect(heading(page)).toHaveText(`${folder} 14`);
    await expect.poll(() => scrollY(page)).toBe(0);
  });

  test("ブラウザの戻るでも一覧の元の位置に戻る @mobile", async ({ page }) => {
    const listY = await openFromScrolledList(page, "E2E スマホの履歴");

    await page.goBack();
    await expectListAt(page, listY, 2);
  });

  test("読了で戻ると一覧の元の位置付近に戻る @mobile", async ({ page }) => {
    const folder = "E2E スマホで読了";
    const listY = await openFromScrolledList(page, folder);

    await page.getByRole("button", { name: "読了にする" }).click();
    // The read card leaves the list, so allow about one card of drift.
    await expectListAt(page, listY, 250);
    await expect(card(page, `${folder} 12`)).toHaveCount(0);
  });

  test("スキップで戻ると一覧の元の位置付近に戻る @mobile", async ({ page }) => {
    const folder = "E2E スマホでスキップ";
    const listY = await openFromScrolledList(page, folder);

    await page.getByRole("button", { name: "スキップ" }).click();
    await expectListAt(page, listY, 250);
    await expect(card(page, `${folder} 12`)).toHaveCount(0);
  });
});
