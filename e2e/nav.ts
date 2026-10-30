import { expect, type Page } from "@playwright/test";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens the folder's tab on the Board. */
export async function openTab(page: Page, folder: string) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "フォルダ" })
    .getByRole("link", { name: new RegExp(`^${escape(folder)}\\s*\\d+$`) })
    .click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
}

/**
 * Goes from the Board to a feed's list, the way the owner does: the folder's tab, then the
 * column's name. `feed` may be left out for a folder with one feed.
 */
export async function openFeed(page: Page, folder: string, feed?: string) {
  await openTab(page, folder);
  const column = feed ? page.getByRole("region", { name: feed, exact: true }) : page.locator("[data-feed]").first();
  await column.getByRole("heading", { level: 3 }).getByRole("link").click();
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+(&a=1)?$/);
}
