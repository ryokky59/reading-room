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

test("一覧のスキップが保存できなければ、カードは戻ってエラーページではなくメッセージが出る", async ({ page }) => {
  const folder = "E2E スキップに失敗";
  await openFolder(page, folder);
  await page.route("**/*", (route) =>
    "next-action" in route.request().headers() ? route.abort() : route.fallback(),
  );

  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" })).toBeVisible();
  await expect(page.locator("li[data-leaving]")).toHaveCount(0);
  await expect(card(page, `${folder} 1`)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(undo(page)).toBeHidden();
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);

  // Pressing again once the server answers skips the card.
  await page.unrouteAll();
  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await expect(count(page)).toHaveText(/^2 本/);
});

test("2 枚続けてスキップして 1 枚目だけ保存できなくても、2 枚目の「元に戻す」は残る", async ({ page }) => {
  const folder = "E2E 続けてスキップ";
  await openFolder(page, folder);
  let first = true;
  await page.route("**/*", async (route) => {
    if (!("next-action" in route.request().headers())) return route.fallback();
    if (!first) return route.fallback();
    first = false;
    await new Promise((r) => setTimeout(r, 500));
    await route.abort();
  });

  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await card(page, `${folder} 2`).getByRole("button", { name: "スキップ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした" })).toBeVisible();
  // The first card is back; the second one is gone, and can still be undone.
  await expect(card(page, `${folder} 1`)).toBeVisible();
  await expect(card(page, `${folder} 2`)).toHaveCount(0);
  await expect(toast(page).getByText("スキップしました")).toBeVisible();
  await undo(page).click();
  await expect(card(page, `${folder} 2`)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(count(page)).toHaveText(/^3 本/);
});

test("「元に戻す」が保存できなければメッセージが出て、もう一度元に戻せる", async ({ page }) => {
  const folder = "E2E 元に戻すに失敗";
  await openFolder(page, folder);
  await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await expect(count(page)).toHaveText(/^2 本/);

  await page.route("**/*", (route) =>
    "next-action" in route.request().headers() ? route.abort() : route.fallback(),
  );
  await undo(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" })).toBeVisible();
  await expect(card(page, `${folder} 1`)).toHaveCount(0);

  await page.unrouteAll();
  await undo(page).click();
  await expect(card(page, `${folder} 1`)).toBeVisible();
  await expect(count(page)).toHaveText(/^3 本/);
  await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした" })).toHaveCount(0);
});

test("元に戻すを押すと、サーバーの返事を待たずにカードが戻る", async ({ page }) => {
  const folder = "E2E 元に戻すに失敗";
  await openFolder(page, folder);
  await page.route("**/*", async (route) => {
    if (!("next-action" in route.request().headers())) return route.fallback();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback().catch(() => {});
  });

  await card(page, `${folder} 2`).getByRole("button", { name: "スキップ" }).click();
  await expect(card(page, `${folder} 2`)).toHaveCount(0);
  // The skip is still on its way to the server.
  await undo(page).click();
  await expect(card(page, `${folder} 2`)).toBeVisible({ timeout: 500 });
  await expect(list(page).getByRole("listitem").nth(1)).toContainText(`${folder} 2`);
  // Once the skip and the restore are saved, the refreshed list still has it.
  await page.waitForTimeout(3500);
  await expect(card(page, `${folder} 2`)).toBeVisible();
});

test("スマホで一覧から開いた記事を読了したあと、ブラウザの戻るで記事が出る @mobile", async ({ page }) => {
  const folder = "E2E 読了して履歴を遡る";
  await openFolder(page, folder);
  const folderUrl = page.url();
  await card(page, `${folder} 1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${folder} 1`);
  const articleUrl = page.url();

  await page.getByRole("button", { name: "読了にする" }).click();
  await expect(page).toHaveURL(folderUrl);
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  // Well after the list has been refreshed.
  await page.waitForTimeout(1500);

  await page.goBack();
  await expect(page).toHaveURL(articleUrl);
  await expect(heading(page)).toHaveText(`${folder} 1`, { timeout: 3000 });
});

test("スマホで記事の URL を直接開いて読了すると、一覧がすぐ出てトーストが出る @mobile", async ({ page }) => {
  const folder = "E2E 直接開いて読了";
  await openFolder(page, folder);
  const folderUrl = page.url();
  const href = await card(page, `${folder} 1`).getByRole("link").getAttribute("href");
  await page.goto(href!);
  await expect(heading(page)).toHaveText(`${folder} 1`);

  await page.getByRole("button", { name: "読了にする" }).click();
  await expect(page).toHaveURL(folderUrl);
  // The list comes with the screen change, not after a later refresh.
  await expect(list(page).getByRole("listitem")).toHaveCount(2, { timeout: 500 });
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await expect(toast(page).getByText("読了にしました")).toBeVisible();

  await undo(page).click();
  await expect(card(page, `${folder} 1`)).toBeVisible();
});

/**
 * Opens article `n` of `folder` by its URL with the list held back, as on a reload. The returned
 * function lets the list through. Other server requests pass unless `blockAll`.
 */
async function openBeforeList(page: Page, folder: string, n: number, { blockAll = false } = {}) {
  await page.goto("/");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${folder}\\s*\\d+$`) }).click();
  await expect(card(page, `${folder} ${n}`)).toBeVisible();
  const href = await card(page, `${folder} ${n}`).getByRole("link").getAttribute("href");

  let release = () => {};
  const released = new Promise<void>((r) => (release = r));
  let failing = blockAll;
  const saves: string[] = [];
  page.on("request", (r) => {
    if ("next-action" in r.headers()) saves.push(r.url());
  });
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (!("rsc" in headers) || "next-router-prefetch" in headers) return route.fallback();
    if (failing) return route.abort();
    if (!/\/articles\/\d+\/list/.test(route.request().url())) return route.fallback();
    await released;
    await route.fallback().catch(() => {});
  });
  await page.goto(href!);
  await expect(heading(page)).toHaveText(`${folder} ${n}`);
  return {
    saves,
    release: () => {
      failing = false;
      release();
    },
  };
}

const readButton = (page: Page) => page.getByRole("button", { name: "読了にする" });
// In the article, not on a list card.
const skipButton = (page: Page) => page.getByRole("main").getByRole("button", { name: "スキップ" });

/** Both buttons can be seen not to work yet. */
async function expectHeldBack(page: Page) {
  for (const button of [readButton(page), skipButton(page)]) {
    await expect(button).toBeDisabled();
    expect(await style(button, "opacity")).toBe("0.5");
  }
}

test.describe("記事を直接開いて一覧が届く前", () => {
  test("PC では読了・スキップが押せず、届いたら読了ですぐ下の記事が開く", async ({ page }) => {
    const folder = "E2E 一覧待ちで読了";
    const { saves, release } = await openBeforeList(page, folder, 2);
    await expectHeldBack(page);
    await readButton(page).click({ force: true });
    await page.waitForTimeout(300);
    expect(saves).toEqual([]);
    await expect(heading(page)).toHaveText(`${folder} 2`);

    release();
    // Pressed as soon as it can be: the article URL may still be on its way back.
    await expect(readButton(page)).toBeEnabled();
    await readButton(page).click();
    await expect(heading(page)).toHaveText(`${folder} 3`, { timeout: 2000 });
    await expect(card(page, `${folder} 2`)).toHaveCount(0);
    await expect(toast(page).getByText("読了にしました")).toBeVisible();
  });

  test("PC のスキップも、届いたらすぐ下の記事が開く", async ({ page }) => {
    const folder = "E2E 一覧待ちでスキップ";
    const { release } = await openBeforeList(page, folder, 2);
    await expectHeldBack(page);

    release();
    await expect(skipButton(page)).toBeEnabled();
    await skipButton(page).click();
    await expect(heading(page)).toHaveText(`${folder} 3`, { timeout: 2000 });
    await expect(toast(page).getByText("スキップしました")).toBeVisible();
  });

  test("e / s は効かず、届いたら効く", async ({ page }) => {
    const folder = "E2E 一覧待ちのキー";
    const { saves, release } = await openBeforeList(page, folder, 2);
    await expectHeldBack(page);
    await page.keyboard.press("e");
    await page.keyboard.press("s");
    await page.waitForTimeout(300);
    expect(saves).toEqual([]);
    await expect(heading(page)).toHaveText(`${folder} 2`);

    release();
    await expect(skipButton(page)).toBeEnabled();
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText(`${folder} 3`, { timeout: 2000 });
  });

  test("届いたあとの保存に失敗しても、メッセージが出てもう一度押せる", async ({ page }) => {
    const folder = "E2E 一覧待ちで失敗";
    const { release } = await openBeforeList(page, folder, 2);
    release();
    await expect(readButton(page)).toBeEnabled();
    await expect(list(page).getByRole("listitem")).toHaveCount(3);

    await page.unrouteAll();
    await page.route("**/*", (route) =>
      "next-action" in route.request().headers() ? route.abort() : route.fallback(),
    );
    await readButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" })).toBeVisible();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);

    await page.unrouteAll();
    await readButton(page).click();
    await expect(heading(page)).toHaveText(`${folder} 3`);
  });

  test("一覧の取得が失敗しても、通信が戻れば押せるようになる", async ({ page }) => {
    const folder = "E2E 一覧が届かない";
    const { release } = await openBeforeList(page, folder, 2, { blockAll: true });
    await expect(readButton(page)).toBeDisabled();
    // The router falls back to loading the page again, and again the list does not come.
    await page.waitForTimeout(500);
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(readButton(page)).toBeDisabled();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);

    release();
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(readButton(page)).toBeEnabled();
    await readButton(page).click();
    await expect(heading(page)).toHaveText(`${folder} 3`);
  });

  test("スマホの縦向きは一覧を待たずに押せる @mobile", async ({ page }) => {
    const folder = "E2E 一覧待ちの横向き";
    const { saves } = await openBeforeList(page, folder, 1);
    await expect(readButton(page)).toBeEnabled();
    await readButton(page).click();
    await expect(heading(page)).toHaveCount(0);
    await expect(card(page, `${folder} 1`)).toHaveCount(0);
    expect(saves.length).toBeGreaterThan(0);
  });

  test.describe("スマホの横向き", () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test("PC と同じく押せず、届いたらすぐ下の記事が開く @mobile", async ({ page }) => {
      const folder = "E2E 一覧待ちの横向き";
      const { release } = await openBeforeList(page, folder, 2);
      await expectHeldBack(page);

      release();
      await expect(readButton(page)).toBeEnabled();
      await readButton(page).click();
      await expect(heading(page)).toHaveText(`${folder} 3`, { timeout: 2000 });
    });
  });
});
