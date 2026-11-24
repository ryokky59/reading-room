import { expect, test, type Locator, type Page, type Route } from "./test";
import { openFeed } from "./nav";

// Read and skipped cards leave the list (スキップ to the left, 読了 to the right), the cards
// below close up, and a toast offers 「元に戻す」 for 4 seconds.
// Each test uses its own folder from the end of e2e/seed.mts, with 3 articles.

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

// The widest screen with the list beside an open article: from `lg` up the article is a sheet.
const BESIDE = { width: 1000, height: 800 };

async function openFolder(page: Page, name: string) {
  await openFeed(page, name);
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
  await expect.poll(async () => (await card(page, `${folder} 2`).boundingBox())?.y ?? -Infinity).toBeCloseTo(firstTop, 0);
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

test("スマホで読了にすると一覧に戻ってカードが右へ抜け、「元に戻す」で既読のまま戻って読了一覧には出ない @mobile", async ({
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

  // As it was before 読了: opening it had marked it seen (既読), so it is back faded and the
  // unread count stays.
  await undo(page).click();
  await expect(card(page, `${folder} 2`)).toHaveAttribute("data-seen", "");
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(count(page)).toHaveText(/^2 本/);
  await expect(card(page, `${folder} 1`)).not.toHaveAttribute("data-seen", "");

  // A seen card leaves on a full load, and 既読を含む has it.
  await page.reload();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  await expect(card(page, `${folder} 2`)).toHaveCount(0);
  await expect(count(page)).toHaveText(/^2 本/);
  await page.getByRole("switch", { name: "既読を含む" }).click();
  await expect(card(page, `${folder} 2`)).toHaveAttribute("data-seen", "");

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

  // Opening it had marked it seen (既読), and it comes back so.
  await undo(page).click();
  await expect(list(page).getByRole("listitem").first()).toContainText(`${folder} 1`);
  await expect(card(page, `${folder} 1`)).toHaveAttribute("data-seen", "");
  await expect(count(page)).toHaveText(/^2 本/);
});

test("PC で e を押すと次の記事が開いてカードが右へ抜け、「元に戻す」で既読のまま一覧に戻っても記事は変わらない", async ({
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

  // Left of the article sheet, clear of the article's buttons.
  const toastBox = (await toast(page).locator("[data-open]").boundingBox())!;
  const sheetBox = (await page.getByRole("dialog", { name: "記事" }).boundingBox())!;
  expect(toastBox.x).toBeGreaterThanOrEqual(0);
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(sheetBox.x);
  await expect(toast(page).getByText("読了にしました")).toBeVisible();

  // Articles 1 and 2 have been opened, so only the third is unread.
  await expect(count(page)).toHaveText(/^1 本/);

  await undo(page).click();
  await expect(list(page).getByRole("listitem").first()).toContainText(`${folder} 1`);
  await expect(list(page).getByRole("listitem")).toHaveCount(3);
  await expect(heading(page)).toHaveText(`${folder} 2`);
  expect(page.url()).toBe(articleUrl);
  await expect(card(page, `${folder} 2`)).toHaveAttribute("aria-current", "true");
  // Back as it was before 読了: seen (既読), so faded and out of the unread count.
  await expect(card(page, `${folder} 1`)).toHaveAttribute("data-seen", "");
  await expect(toast(page).getByText("読了にしました")).toBeHidden();
  await expect(count(page)).toHaveText(/^1 本/);

  // With the article closed, a full load drops the seen cards; 既読を含む has them.
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(card(page, `${folder} 1`)).toHaveAttribute("data-seen", "");
  await page.reload();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(card(page, `${folder} 1`)).toHaveCount(0);
  await expect(count(page)).toHaveText(/^1 本/);
  await page.getByRole("switch", { name: "既読を含む" }).click();
  await expect(card(page, `${folder} 1`)).toHaveAttribute("data-seen", "");
  await page.goto("/read");
  await expect(page.getByText(`${folder} 1`, { exact: true })).toHaveCount(0);
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
 * function lets the list through. Other server requests pass.
 */
async function openBeforeList(page: Page, folder: string, n: number) {
  await openFeed(page, folder);
  await expect(card(page, `${folder} ${n}`)).toBeVisible();
  const href = await card(page, `${folder} ${n}`).getByRole("link").getAttribute("href");

  let release = () => {};
  const released = new Promise<void>((r) => (release = r));
  const saves: string[] = [];
  page.on("request", (r) => {
    if ("next-action" in r.headers()) saves.push(r.url());
  });
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (!("rsc" in headers) || "next-router-prefetch" in headers) return route.fallback();
    if (!/\/articles\/\d+\/list/.test(route.request().url())) return route.fallback();
    await released;
    await route.fallback().catch(() => {});
  });
  await page.goto(href!);
  await expect(heading(page)).toHaveText(`${folder} ${n}`);
  return { saves, release };
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

// Reloading an article while the device is offline: the Service Worker serves the article it kept,
// and the list beside it waits for the network instead of the page being replaced by the offline
// page (#128). The network is cut with setOffline, not page.route: page.route does not reach the
// requests of a page the Service Worker controls (#113).
test.describe("オフラインで記事を読み込み直す", () => {
  test.use({ serviceWorkers: "allow" });

  /** Opens article `n` of `folder` by its URL once the Service Worker controls the page, so it keeps the article. */
  async function openWithWorker(page: Page, folder: string, n: number) {
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await openFeed(page, folder);
    const href = await card(page, `${folder} ${n}`).getByRole("link").getAttribute("href");
    await page.goto(href!);
    await expect(heading(page)).toHaveText(`${folder} ${n}`);
    return href!;
  }

  /** Counts the document loads of `/articles/<id>/list`, which offline would be the offline page. */
  function countListDocuments(page: Page) {
    const loads: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document" && /\/articles\/\d+\/list/.test(r.url())) loads.push(r.url());
    });
    return loads;
  }

  const offlineNote = (page: Page) => page.getByText("オフラインです。通信が戻ると一覧が出ます");

  test("PC では記事が出たまま一覧の場所に「オフラインです」が出て、通信が戻ると一覧が届いて押せる", async ({
    page,
    context,
  }) => {
    const folder = "E2E 一覧が届かない";
    const href = await openWithWorker(page, folder, 2);
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(readButton(page)).toBeEnabled();
    // Back on the article's URL from /articles/<id>/list, so the reload is the article the worker kept.
    await expect(page).toHaveURL(href);

    const listLoads = countListDocuments(page);
    await context.setOffline(true);
    await page.reload();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(offlineNote(page)).toBeVisible();
    await expect(readButton(page)).toBeDisabled();
    await expect(page).not.toHaveTitle("オフライン | Reading Room");
    await expect(heading(page)).toHaveText(`${folder} 2`);

    await context.setOffline(false);
    // The open article is read now, and its row stays.
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(offlineNote(page)).toHaveCount(0);
    await expect(readButton(page)).toBeEnabled();
    await readButton(page).click();
    await expect(heading(page)).toHaveText(`${folder} 3`);
    expect(listLoads).toEqual([]);
  });

  test("スマホの縦向きでは記事が出たままで、「オフラインです」は出ない @mobile", async ({ page, context }) => {
    const folder = "E2E スマホでオフラインのまま開き直す";
    await openWithWorker(page, folder, 2);

    const listLoads = countListDocuments(page);
    await context.setOffline(true);
    await page.reload();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(readButton(page)).toBeEnabled();
    await expect(page).not.toHaveTitle("オフライン | Reading Room");
    await expect(offlineNote(page)).toBeHidden();
    await expect(list(page)).toBeHidden();
    expect(listLoads).toEqual([]);
  });
});

// Browser back pressed while 読了 / スキップ is still being saved: the list it went back to stays,
// without the card, instead of the next article opening over it once the save is done. The same
// for the open article's card's 「未読に戻す」, which would otherwise close the page gone back to.
test.describe("保存中にブラウザの戻る", () => {
  /** Opens the first article of `folder` from its list, and holds server actions back 1.5 s. */
  async function openFirstSlowly(page: Page, folder: string, fail = false) {
    await openFolder(page, folder);
    const folderUrl = page.url();
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    let done = () => {};
    const answered = new Promise<void>((r) => (done = r));
    await page.route("**/*", async (route) => {
      if (!("next-action" in route.request().headers())) return route.fallback();
      await new Promise((r) => setTimeout(r, 1500));
      await (fail ? route.abort() : route.fallback()).catch(() => {});
      done();
    });
    return { folderUrl, answered };
  }

  for (const [kind, button, message] of [
    ["読了", readButton, "読了にしました"],
    ["スキップ", skipButton, "スキップしました"],
  ] as const) {
    test(`PC で${kind}の保存中に戻ると、保存のあとも一覧のままでカードが抜ける`, async ({ page }) => {
      const folder = `E2E ${kind}の保存中に戻る`;
      const { folderUrl, answered } = await openFirstSlowly(page, folder);

      await button(page).click();
      await page.waitForTimeout(200);
      await page.goBack();
      await answered;

      await expect(card(page, `${folder} 1`)).toHaveCount(0);
      await expect(count(page)).toHaveText(/^2 本/);
      await expect(toast(page).getByText(message)).toBeVisible();
      await expect(heading(page)).toHaveCount(0);
      // Long enough for a late push to the next article to have landed.
      await page.waitForTimeout(1000);
      expect(page.url()).toBe(folderUrl);
      await expect(heading(page)).toHaveCount(0);
    });
  }

  test("PC で保存に失敗してから戻った一覧には、カードが残ってエラーページにならない", async ({ page }) => {
    const folder = "E2E 保存に失敗して戻る";
    const { folderUrl, answered } = await openFirstSlowly(page, folder, true);

    await readButton(page).click();
    await page.waitForTimeout(200);
    await page.goBack();
    await answered;

    await page.waitForTimeout(1000);
    expect(page.url()).toBe(folderUrl);
    await expect(heading(page)).toHaveCount(0);
    await expect(card(page, `${folder} 1`)).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    // Opening the article marked it seen (既読), so the unread count is one less than the cards.
    await expect(count(page)).toHaveText(/^2 本/);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  });

  /**
   * Opens the first article of `folder`, then the second with `j`, and holds server actions back:
   * the second card's 「未読に戻す」 is then pressed with the first article one step back (#76).
   */
  async function openSecondSlowly(page: Page, folder: string, fail = false) {
    // The open article's card is beside it below `lg` only.
    await page.setViewportSize(BESIDE);
    const { answered } = await openFirstSlowly(page, folder, fail);
    const firstUrl = page.url();
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    expect(page.url()).not.toBe(firstUrl);
    return { firstUrl, answered };
  }
  const unsee = (page: Page, title: string) => card(page, title).getByRole("button", { name: "未読に戻す" });

  test("PC で開いている記事のカードの「未読に戻す」の保存中に戻ると、前の記事のままでカードは未読に戻る", async ({
    page,
  }) => {
    const folder = "E2E 未読に戻すの保存中に戻る";
    const { firstUrl, answered } = await openSecondSlowly(page, folder);

    await unsee(page, `${folder} 2`).click();
    await page.waitForTimeout(200);
    await page.goBack();
    await answered;

    // Long enough for a late push to the list to have landed.
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(firstUrl);
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await expect(unsee(page, `${folder} 2`)).toHaveCount(0);
    await expect(count(page)).toHaveText(/^2 本/);
  });

  test("PC で開いている記事のカードの「未読に戻す」に失敗してから戻ると、前の記事のままでメッセージが出る", async ({
    page,
  }) => {
    const folder = "E2E 未読に戻すに失敗して戻る";
    const { firstUrl, answered } = await openSecondSlowly(page, folder, true);

    await unsee(page, `${folder} 2`).click();
    await page.waitForTimeout(200);
    await page.goBack();
    await answered;

    await expect(toast(page).getByText("保存できませんでした。もう一度押してください")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(firstUrl);
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await expect(unsee(page, `${folder} 2`)).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  });
});

// An article the list beside it does not show (#54): the 31st and later of a feed, opened from
// its URL, as from the browser's history. 読了 / スキップ open the next unread after it, not the
// top of the list. Each test opens its own rows of "E2E 載っていないサイト" (e2e/seed.mts).
test.describe("一覧に載っていない記事", () => {
  const feedName = "E2E 載っていないサイト";
  const title = (n: number) => `載っていない記事 ${n}`;
  const emptyPane = (page: Page) => page.getByText("一覧から記事を選ぶと、ここで読めます。");

  /**
   * The article's URL, with the feed's filter (`?f=…&s=…`) or none (すべて). Read from the feed's
   * list grown by 「もっと見る」, as no list shows the article otherwise.
   */
  async function urlOf(page: Page, n: number, { filtered }: { filtered: boolean }) {
    await openFeed(page, "E2E 載っていない記事", feedName);
    const query = new URL(page.url()).search;
    await page.goto(`/${query}&n=60`);
    const href = (await card(page, title(n)).getByRole("link").getAttribute("href"))!;
    const id = /^\/articles\/(\d+)/.exec(href)![1];
    return { url: `/articles/${id}${filtered ? query : ""}`, query };
  }

  /** Opens the article from its URL and waits for the list beside it (30 cards, without it). */
  async function openUnlisted(page: Page, n: number, { filtered = false } = {}) {
    await page.setViewportSize(BESIDE);
    const { url, query } = await urlOf(page, n, { filtered });
    await page.goto(url);
    await expect(heading(page)).toHaveText(title(n));
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await expect(card(page, title(n))).toHaveCount(0);
    await expect(readButton(page)).toBeEnabled();
    return { url, query };
  }

  test("PC で URL から開いて読了すると、一覧の先頭ではなくその記事の次が開く", async ({ page }) => {
    // Without a filter: the list beside it is すべて, whose first card used to open.
    const { url } = await openUnlisted(page, 31);
    const first = await list(page).getByRole("heading").first().textContent();
    await readButton(page).click();
    await expect(heading(page)).toHaveText(title(32));
    await expect(heading(page)).not.toHaveText(first!);
    await expect(page).toHaveURL(/\/articles\/\d+$/);
    expect(new URL(page.url()).pathname).not.toBe(url);
    await expect(toast(page).getByText("読了にしました")).toBeVisible();
  });

  test("PC で URL から開いてスキップしても、その記事の次が開く", async ({ page }) => {
    await openUnlisted(page, 33);
    await skipButton(page).click();
    await expect(heading(page)).toHaveText(title(34));
    await expect(toast(page).getByText("スキップしました")).toBeVisible();
  });

  test("e / s でも、その記事の次が開く", async ({ page }) => {
    await openUnlisted(page, 35);
    await page.keyboard.press("e");
    await expect(heading(page)).toHaveText(title(36));

    await openUnlisted(page, 37);
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText(title(38));
  });

  test("サイトで絞り込んで開くと、その絞り込みの中の次が開く。シートでも同じ", async ({ page }) => {
    const { query } = await openUnlisted(page, 39, { filtered: true });
    // From `lg` up the article is a sheet over the same list.
    await page.setViewportSize({ width: 1280, height: 800 });
    await readButton(page).click();
    // Not 「載っていない別サイトの記事」, which comes next in the folder and in すべて.
    await expect(heading(page)).toHaveText(title(40));
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${query}$`));
  });

  test("後ろに未読が無ければ一覧に戻り、一覧の横に空の状態が出る", async ({ page }) => {
    const { query } = await openUnlisted(page, 43, { filtered: true });
    await readButton(page).click();
    await expect(page).toHaveURL(`/${query}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(emptyPane(page)).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
  });

  test("保存に失敗すると記事に留まってメッセージが出て、次の記事を探せなければ一覧に戻る", async ({ page }) => {
    const { query } = await openUnlisted(page, 41, { filtered: true });
    const failing = (route: Route) =>
      "next-action" in route.request().headers() ? route.abort() : route.fallback();
    await page.route("**/*", failing);
    await readButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" })).toBeVisible();
    await expect(heading(page)).toHaveText(title(41));
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    await page.unroute("**/*", failing);

    // Saved this time; looking for the one after it (the second action) fails.
    let sent = 0;
    await page.route("**/*", (route) => {
      if (!("next-action" in route.request().headers())) return route.fallback();
      return ++sent === 2 ? route.abort() : route.fallback();
    });
    await readButton(page).click();
    await expect(page).toHaveURL(`/${query}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(emptyPane(page)).toBeVisible();
    expect(sent).toBe(2);
  });
});
