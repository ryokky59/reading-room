import { expect, test, type Locator, type Page } from "@playwright/test";

// Read and skipped cards leave the list (スキップ to the left, 読了 to the right), the cards
// below close up, and a toast offers 「元に戻す」 for 4 seconds.
// Each test uses its own folder from the end of e2e/seed.mts, with 3 articles.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
/** A card leaving `dir`, found while it is still hidden (with the list, or once it has gone). */
const leavingCard = (page: Page, title: string, dir: "left" | "right") =>
  page.locator(`li[data-leaving="${dir}"]`).filter({ has: page.getByText(title, { exact: true }) });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const count = (page: Page) => page.getByText(/^\d+ 本/);
const toast = (page: Page) => page.getByRole("status");
const undo = (page: Page) => toast(page).getByRole("button", { name: "元に戻す" });
const style = (el: Locator, prop: string) =>
  el.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);

async function openFolder(page: Page, name: string) {
  await page.goto("/");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${name}\\s*\\d+$`) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(count(page)).toHaveText(/^3 本/);
}

test("一覧でスキップするとカードが左へ抜けて詰まり、トーストの「元に戻す」で戻る", async ({ page }) => {
  const folder = "E2E 一覧でスキップ";
  await openFolder(page, folder);
  const firstTop = (await card(page, `${folder} 1`).boundingBox())!.y;

  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await expect(leavingCard(page, `${folder} 1`, "left")).toBeAttached({ timeout: 200 });
  expect(await style(leavingCard(page, `${folder} 1`, "left"), "animation-name")).toBe("leave-left");
  await expect(toast(page).getByText("スキップしました")).toBeVisible();
  await expect(card(page, `${folder} 1`)).toHaveCount(0, { timeout: 1000 });
  // The card below has moved up into the gap.
  await expect.poll(async () => (await card(page, `${folder} 2`).boundingBox())!.y).toBeCloseTo(firstTop, 0);
  await expect(count(page)).toHaveText(/^2 本/);

  await undo(page).click();
  await expect(toast(page).getByText("スキップしました")).toBeHidden();
  await expect(list(page).getByRole("listitem").first()).toContainText(`${folder} 1`);
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(count(page)).toHaveText(/^3 本/);
});

test("トーストは押さなければ約 4 秒で消え、新しいトーストは前のものを置き換える", async ({ page }) => {
  const folder = "E2E 一覧でスキップ";
  await openFolder(page, folder);

  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await expect(toast(page).getByText("スキップしました")).toBeVisible();
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await card(page, `${folder} 2`).getByRole("button", { name: "スキップ" }).click();
  await expect(card(page, `${folder} 2`)).toHaveCount(0);
  // One toast at a time; its undo is for the latest card only.
  await expect(toast(page)).toHaveCount(1);
  await expect(toast(page).getByText("スキップしました")).toHaveCount(1);

  await page.waitForTimeout(3000);
  await expect(toast(page).getByText("スキップしました")).toBeVisible();
  await expect(toast(page).getByText("スキップしました")).toBeHidden({ timeout: 2000 });
  await expect(undo(page)).toBeHidden();
});

test("スマホで読了にすると一覧に戻ってカードが右へ抜け、「元に戻す」で戻って読了一覧には出ない @mobile", async ({
  page,
}) => {
  const folder = "E2E スマホで読了して戻す";
  await openFolder(page, folder);
  const folderUrl = page.url();
  await card(page, `${folder} 2`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${folder} 2`);

  await page.getByRole("button", { name: "読了にする" }).click();
  await expect(page).toHaveURL(folderUrl);
  await expect(heading(page)).toHaveCount(0);
  await expect(leavingCard(page, `${folder} 2`, "right")).toBeAttached();
  await expect(card(page, `${folder} 2`)).toHaveCount(0);
  await expect(toast(page).getByText("読了にしました")).toBeVisible();
  await expect(count(page)).toHaveText(/^2 本/);

  // The toast stays clear of the last card's スキップ.
  const toastBox = (await toast(page).locator("[data-open]").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(viewport.height);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const lastSkip = (await card(page, `${folder} 3`).getByRole("button", { name: "スキップ" }).boundingBox())!;
  expect(lastSkip.y + lastSkip.height).toBeLessThanOrEqual(toastBox.y);

  await undo(page).click();
  await expect(card(page, `${folder} 2`)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(count(page)).toHaveText(/^3 本/);

  await page.goto("/read");
  await expect(page.getByText(`${folder} 2`, { exact: true })).toHaveCount(0);
});

test("スマホでスキップすると一覧に戻ってカードが左へ抜け、「元に戻す」で戻る @mobile", async ({ page }) => {
  const folder = "E2E スマホでスキップして戻す";
  await openFolder(page, folder);
  await card(page, `${folder} 1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${folder} 1`);

  await page.getByRole("button", { name: "スキップ" }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(leavingCard(page, `${folder} 1`, "left")).toBeAttached();
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await expect(toast(page).getByText("スキップしました")).toBeVisible();

  await undo(page).click();
  await expect(list(page).getByRole("listitem").first()).toContainText(`${folder} 1`);
  await expect(count(page)).toHaveText(/^3 本/);
});

test("PC で e を押すと次の記事が開いてカードが右へ抜け、「元に戻す」で一覧に戻っても記事は変わらない", async ({
  page,
}) => {
  const folder = "E2E PC で読了して戻す";
  await openFolder(page, folder);
  await card(page, `${folder} 1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${folder} 1`);

  await page.keyboard.press("e");
  await expect(leavingCard(page, `${folder} 1`, "right")).toBeAttached();
  await expect(heading(page)).toHaveText(`${folder} 2`);
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  const articleUrl = page.url();

  // In the list pane, clear of the article's buttons.
  const toastBox = (await toast(page).locator("[data-open]").boundingBox())!;
  const listBox = (await list(page).boundingBox())!;
  expect(toastBox.x).toBeGreaterThanOrEqual(listBox.x - 1);
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
  await expect(toast(page).getByText("読了にしました")).toBeVisible();

  await undo(page).click();
  await expect(list(page).getByRole("listitem").first()).toContainText(`${folder} 1`);
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(heading(page)).toHaveText(`${folder} 2`);
  expect(page.url()).toBe(articleUrl);
  await expect(card(page, `${folder} 2`)).toHaveAttribute("aria-current", "true");
});

test("動きを減らす設定では、カードは動かずすぐ消え、トーストは出る", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const folder = "E2E 動きを減らして抜ける";
  await openFolder(page, folder);
  // Keeps the card in the page until the check below: the list drops it once the action is done.
  await page.route("**/*", async (route) => {
    if (!("next-action" in route.request().headers())) return route.fallback();
    await new Promise((r) => setTimeout(r, 1000));
    await route.fallback().catch(() => {});
  });

  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  // Text in a hidden card cannot be matched; only this card is leaving.
  const leaving = page.locator('li[data-leaving="left"]');
  // Hidden at once, before the list is refreshed.
  await expect(leaving).toBeHidden({ timeout: 200 });
  expect(await style(leaving, "animation-name")).toBe("none");
  await expect(toast(page).getByText("スキップしました")).toBeVisible();
  expect(await style(toast(page).locator(".toast"), "transition-duration")).toBe("0s");
  await expect(count(page)).toHaveText(/^2 本/);
});
