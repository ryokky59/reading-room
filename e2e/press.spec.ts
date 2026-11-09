import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

// Press feedback: what is held sinks, the pressed card stays outlined while its article loads,
// a bar runs at the top of the screen, and 読了 / スキップ show a spinner and take one press.
// Tests that read use the "E2E 押した感" folder from the end of e2e/seed.mts.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const pendingCards = (page: Page) => page.locator('li:has([data-pending="true"])');
const bar = (page: Page) => page.locator("[data-nav-progress]");
const activeBar = (page: Page) => page.locator('[data-nav-progress][data-active="true"]');
const style = (el: Locator, prop: string) =>
  el.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
const ACCENT = "rgb(181, 83, 44)";

/**
 * Makes every page change wait for the server: prefetches fail, so nothing is ready when a
 * link is pressed, and the page's answer comes `ms` late. Set before the first page load.
 */
async function slowPages(page: Page, ms = 1000) {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (!("rsc" in headers) || "next-action" in headers) return route.fallback();
    if ("next-router-prefetch" in headers) return route.abort();
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback().catch(() => {}); // the router may have moved on
  });
}

/** Delays server actions by `ms` and returns a function that counts those sent so far. */
async function slowActions(page: Page, ms = 1000) {
  let sent = 0;
  await page.route("**/*", async (route) => {
    if (!("next-action" in route.request().headers())) return route.fallback();
    sent++;
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback().catch(() => {});
  });
  return () => sent;
}

/**
 * Makes the server actions numbered in `failing` (1 = the first sent from now on) fail as if
 * the connection dropped, after `ms`. Returns a function that stops failing them.
 */
async function failActions(page: Page, failing: number[] | "all", ms = 0) {
  let sent = 0;
  const handler = async (route: Route) => {
    if (!("next-action" in route.request().headers())) return route.fallback();
    sent++;
    if (failing !== "all" && !failing.includes(sent)) return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    await route.abort().catch(() => {});
  };
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}
const failure = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした" });

async function openFolder(page: Page, name: string) {
  await page.goto("/");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${name}\\s*\\d+$`) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
}

test("押している間だけカード・チップ・ボタンが縮み、カードのスキップではカードは縮まない", async ({ page }) => {
  await page.goto("/?a=1"); // Keeps the card listed once another test has opened it.
  const item = card(page, "本番で動くエージェント");
  const box = async (el: Locator) => {
    const b = (await el.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  /** Holds the mouse on `el`, runs `check`, then lets go elsewhere so nothing is clicked. */
  const hold = async (el: Locator, check: () => Promise<void>) => {
    // Articles fetched by earlier tests (e2e/fetch.spec.ts) can push the card down the list.
    await el.scrollIntoViewIfNeeded();
    const { x, y } = await box(el);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await check();
    await page.mouse.move(1, 1);
    await page.mouse.up();
  };

  await hold(item.getByRole("link"), async () => {
    await expect.poll(() => style(item, "transform")).toBe("matrix(0.97, 0, 0, 0.97, 0, 0)");
  });
  await expect.poll(() => style(item, "transform")).toBe("none");

  const skip = item.getByRole("button", { name: "スキップ" });
  await hold(skip, async () => {
    await expect.poll(() => style(skip, "transform")).toBe("matrix(0.94, 0, 0, 0.94, 0, 0)");
    expect(await style(item, "transform")).toBe("none");
  });

  const chip = folderNav(page).getByRole("link", { name: /^すべて/ });
  await hold(chip, async () => {
    await expect.poll(() => style(chip, "transform")).toBe("matrix(0.94, 0, 0, 0.94, 0, 0)");
  });
  await expect.poll(() => style(chip, "transform")).toBe("none");
});

test("記事が出るまで押したカードだけに枠が付き、画面上部にバーが出る", async ({ page }) => {
  await slowPages(page);
  await openFolder(page, "E2E たくさん");
  await expect(bar(page)).toBeAttached();
  await expect(activeBar(page)).toHaveCount(0);

  const item = card(page, "量産記事 3");
  await item.getByRole("link").click();
  await expect(pendingCards(page)).toHaveCount(1);
  await expect(item).toHaveAttribute("class", /pressable-card/);
  await expect(item.locator("h2")).toHaveCSS("color", ACCENT);
  await expect(activeBar(page)).toBeVisible();
  // Across the top of the screen, above the header.
  const b = (await bar(page).boundingBox())!;
  expect(b.y).toBe(0);
  expect(b.width).toBe(page.viewportSize()!.width);

  await expect(heading(page)).toHaveText("量産記事 3");
  await expect(pendingCards(page)).toHaveCount(0);
  await expect(activeBar(page)).toHaveCount(0);
  await expect(item.locator("h2")).not.toHaveCSS("color", ACCENT);
});

test("チップと「もっと見る」でも、一覧が変わるまでバーが出る", async ({ page }) => {
  await slowPages(page);
  await page.goto("/?a=1"); // Keeps 35 cards once other tests have opened some of them.

  await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
  await expect(activeBar(page)).toBeVisible();
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
  await expect(activeBar(page)).toHaveCount(0);

  await page.getByRole("link", { name: /もっと見る/ }).click();
  await expect(activeBar(page)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(35);
  await expect(activeBar(page)).toHaveCount(0);
});

test("読了にすると画面が変わるまでくるくるが出て、二度押しても 1 回だけ読了になる @mobile", async ({ page }) => {
  await openFolder(page, "E2E 押した感");
  const folderUrl = page.url();
  await card(page, "押した感 1").getByRole("link").click();
  await expect(heading(page)).toHaveText("押した感 1");

  const sent = await slowActions(page);
  const read = page.getByRole("button", { name: "読了にする" });
  const skip = page.getByRole("button", { name: "スキップ" });
  await read.dblclick();
  await expect(read).toHaveAttribute("aria-busy", "true");
  await expect(read.locator(".spin")).toBeVisible();
  await expect(read).toBeDisabled();
  await expect(skip).toBeDisabled();
  await expect(activeBar(page)).toBeVisible();

  await expect(page).toHaveURL(folderUrl);
  await expect(card(page, "押した感 1")).toHaveCount(0);
  await expect(activeBar(page)).toHaveCount(0);
  expect(sent()).toBe(1);
});

test("動きを減らす設定では、カードは縮まずバーとくるくるは止まって表示される", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowPages(page);
  await openFolder(page, "E2E 押した感");

  const item = card(page, "押した感 2");
  expect(await style(item, "transition-duration")).toBe("0s");
  const chip = folderNav(page).getByRole("link", { name: /^すべて/ });
  expect(await style(chip, "transition-duration")).toBe("0s");

  await item.getByRole("link").click();
  await expect(activeBar(page)).toBeVisible();
  expect(await style(bar(page).locator("i"), "animation-name")).toBe("none");
  await expect(heading(page)).toHaveText("押した感 2");

  await slowActions(page);
  const read = page.getByRole("button", { name: "読了にする" });
  await read.click();
  const spin = read.locator(".spin");
  await expect(spin).toBeVisible();
  expect(await style(spin, "animation-name")).toBe("none");
  await expect(heading(page)).not.toHaveText("押した感 2");
});

test("読了・スキップ・未読に戻すが保存できないと、記事に残ってメッセージが出て、もう一度押せる", async ({ page }) => {
  await openFolder(page, "E2E 押した感");
  await card(page, "押した感 4").getByRole("link").click();
  await expect(heading(page)).toHaveText("押した感 4");

  let stop = await failActions(page, "all", 500);
  // The article's own buttons, not the cards' スキップ in the list beside it.
  const read = page.getByRole("main").getByRole("button", { name: "読了にする" });
  const skip = page.getByRole("main").getByRole("button", { name: "スキップ" });
  const width = async (el: Locator) => (await el.boundingBox())!.width;
  const skipWidth = await width(skip);
  const readWidth = await width(read);
  await skip.click();
  // The spinner does not change the buttons' size.
  await expect(skip.locator(".spin")).toBeVisible();
  expect(await width(skip)).toBe(skipWidth);
  expect(await width(read)).toBe(readWidth);

  await expect(failure(page)).toBeVisible();
  await expect(heading(page)).toHaveText("押した感 4");
  await expect(skip).toBeEnabled();
  await expect(read).toBeEnabled();
  await expect(skip.locator(".spin")).toHaveCount(0);

  await read.click();
  await expect(failure(page)).toBeVisible();
  await stop();
  await read.click();
  // It was the folder's last unread beside the list, so the list's empty state follows.
  await expect(page.getByRole("heading", { level: 1, name: "押した感 4" })).toHaveCount(0);
  await expect(failure(page)).toHaveCount(0);
  await expect(card(page, "押した感 4")).toHaveCount(0);

  // 未読に戻す: the same message, not the error page.
  await page.goto("/read");
  await page.getByRole("link", { name: /押した感 5/ }).click();
  await expect(heading(page)).toHaveText("押した感 5");
  stop = await failActions(page, "all");
  const restore = page.getByRole("button", { name: "未読に戻す" });
  await restore.click();
  await expect(failure(page)).toBeVisible();
  await expect(heading(page)).toHaveText("押した感 5");
  await expect(restore).toBeEnabled();
  await stop();
  await restore.click();
  await expect(page).toHaveURL("/");
  await openFolder(page, "E2E 押した感");
  await expect(card(page, "押した感 5")).toBeVisible();
});

test("読了は保存できて次の記事を探せなかったときは、一覧に戻って画面と保存した状態がそろう", async ({ page }) => {
  await openFolder(page, "E2E 次が取れない");
  const folderUrl = page.url();
  await card(page, "次が取れない記事").getByRole("link").click();
  await expect(heading(page)).toHaveText("次が取れない記事");

  // The first action marks it read; the second (looking for the next unread) fails.
  await failActions(page, [2]);
  await page.getByRole("button", { name: "読了にする" }).click();
  await expect(page).toHaveURL(folderUrl);
  await expect(heading(page)).toHaveCount(0);
  await expect(card(page, "次が取れない記事")).toHaveCount(0);
  await expect(failure(page)).toHaveCount(0);
});
