import { sideOverflows } from "./fits";
import { openTab } from "./nav";
import { expect, test, type Page, type Request } from "./test";

// The timeline (`/?v=t`): every site of a folder tab in one list, newest published first. Folders
// are the 「E2E 時系列…」 ones at the end of e2e/seed.mts: in each, "<folder> 1" is the newest
// published (site A), "<folder> 2" the next (site B) and so on, while B was fetched before A.

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const list = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const titles = (page: Page) => list(page).getByRole("heading", { level: 2 }).allTextContents();
const viewNav = (page: Page) => page.getByRole("navigation", { name: "表示" });
const byBoard = (page: Page) => viewNav(page).getByRole("link", { name: "サイト別" });
const byTime = (page: Page) => viewNav(page).getByRole("link", { name: "時系列" });
const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
// Not the toast's 「N 本を既読にしました」.
const unread = (page: Page) => page.getByText(/^\d+ 本$/);
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const failed = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

const PC = { width: 1280, height: 800 };
// The widest screen with the list beside an open article: from `lg` up the article is a sheet.
const BESIDE = { width: 1000, height: 800 };

const header = (page: Page) => page.locator("header[data-app-header]");
const logo = (page: Page) => header(page).getByRole("link", { name: "Reading Room", exact: true });
const inboxTab = (page: Page) => header(page).getByRole("link", { name: "新着", exact: true });

/** Shows the timeline of every folder: `/?v=t`, the すべて tab, no Board column. */
async function expectAllTimeline(page: Page) {
  await expect(page).toHaveURL(/\/\?v=t$/);
  await expect(heading(page)).toHaveCount(0);
  await expect(list(page)).toBeVisible();
  await expect(byTime(page)).toHaveAttribute("aria-current", "page");
  await expect(folderNav(page).getByRole("link", { name: /^すべて/ })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-feed]")).toHaveCount(0);
}

/**
 * On a folder's timeline, 新着 and then the logo lead to the timeline of every folder, and `/`
 * loaded after that is still the timeline (#194).
 */
async function homeStaysOnTimeline(page: Page) {
  const folder = "E2E 時系列";
  for (const link of [inboxTab, logo]) {
    await openTimeline(page, folder);
    await link(page).click();
    await expectAllTimeline(page);
  }
  await page.goto("/");
  await expectAllTimeline(page);
}

/** The folder's tab on the Board, then 時系列. Answers the Board's count for the tab. */
async function openTimeline(page: Page, folder: string) {
  await openTab(page, folder);
  const boardCount = await unread(page).textContent();
  await byTime(page).click();
  await expect(page).toHaveURL(/\/\?f=\d+&v=t$/);
  await expect(list(page)).toBeVisible();
  return boardCount;
}

test("ボードの「時系列」で全フォルダの未読が公開の新しい順に 1 列で出る。未来の日付は取得時刻の位置、止まったフィードは出ない", async ({ page }) => {
  const folder = "E2E 時系列";
  const boardCount = await openTimeline(page, folder);
  await expect(byTime(page)).toHaveAttribute("aria-current", "page");
  await expect(byBoard(page)).not.toHaveAttribute("aria-current");
  // One list of cards, no Board columns.
  await expect(page.locator("[data-feed]")).toHaveCount(0);
  // As many as the Board's tab says, the paused feed's unread among them.
  await expect(unread(page)).toHaveText(boardCount!);
  // B was fetched before A, but its articles come out between A's. The one dated tomorrow was
  // fetched between 6 and 7.
  expect((await titles(page)).slice(0, 10)).toEqual([
    ...[1, 2, 3, 4, 5, 6].map((k) => `${folder} ${k}`),
    `${folder} 未来`,
    ...[7, 8, 9].map((k) => `${folder} ${k}`),
  ]);
  await expect(card(page, `${folder} 止めた 1`)).toHaveCount(0);
  // No site chips: the timeline is for reading them mixed.
  await expect(page.getByRole("navigation", { name: "サイト" })).toHaveCount(0);

  // The time it is placed by, to the minute.
  const timeOf = async (title: string) => (await card(page, title).getByText(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/).textContent())!;
  const future = await timeOf(`${folder} 未来`);
  expect([await timeOf(`${folder} 6`), await timeOf(`${folder} 7`)]).toContain(future);

  // 「もっと見る」, 既読を含む and the folder tabs keep the timeline.
  await page.getByRole("link", { name: /^もっと見る/ }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&v=t&n=60$/);
  await expect(list(page).getByRole("listitem")).toHaveCount(35);
  await page.getByRole("switch", { name: "既読を含む" }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&v=t&n=60&a=1$/);
  await expect(page.getByRole("switch", { name: "既読を含む" })).toHaveAttribute("aria-checked", "true");
  await expect(byTime(page)).toHaveAttribute("aria-current", "page");

  // サイト別 goes back to the Board of the same tab, without 既読を含む.
  const tab = folderNav(page).getByRole("link", { name: new RegExp(`^${folder}\\s*\\d+$`) });
  await byBoard(page).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(column(page, `${folder} A`)).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");

  await byTime(page).click();
  await expect(page).toHaveURL(/\/\?f=\d+&v=t$/);
  await folderNav(page).getByRole("link", { name: /^すべて/ }).click();
  await expect(page).toHaveURL(/\/\?v=t$/);
  await expect(byTime(page)).toHaveAttribute("aria-current", "page");
  await expect(list(page).getByRole("listitem").first()).toBeVisible();

  // From the Board of every folder too.
  await byBoard(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(byBoard(page)).toHaveAttribute("aria-current", "page");
  await byTime(page).click();
  await expect(page).toHaveURL(/\/\?v=t$/);
  await expect(page.locator("[data-feed]")).toHaveCount(0);
  await expect(list(page).getByRole("listitem")).toHaveCount(30);
});

test.describe("PC 幅", () => {
  test("時系列のカードを開くと記事が出てカードは薄く残り、j / k と e は時系列の順に進む。未読数は閉じた時に減る", async ({ page }) => {
    const folder = "E2E 時系列で開く";
    await page.setViewportSize(PC);
    await openTimeline(page, folder);
    await expect(unread(page)).toHaveText("4 本");
    expect(await titles(page)).toEqual([1, 2, 3, 4].map((k) => `${folder} ${k}`));

    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&v=t$/);
    // Seen, so it offers 「未読に戻す」; it fades once another article is open.
    await expect(card(page, `${folder} 1`)).toHaveAttribute("data-unsee", "");
    await expect(list(page).getByRole("listitem")).toHaveCount(4);
    // As in a feed list: the list is not fetched again while the article is open.
    await expect(unread(page)).toHaveText("4 本");

    // In the list's order, not by site: 2 is B's.
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(card(page, `${folder} 1`)).toHaveAttribute("data-seen", "");
    await expect(list(page).getByRole("listitem")).toHaveCount(4);
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await page.keyboard.press("e");
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&v=t$/);

    // Closing goes back to the timeline, fetched again: 1 read and 2 seen.
    await page.getByRole("button", { name: "記事を閉じる" }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&v=t$/);
    await expect(unread(page)).toHaveText("2 本");
    await expect(card(page, `${folder} 1`)).toHaveCount(0);
    await expect(card(page, `${folder} 2`)).toHaveAttribute("data-seen", "");
  });

  test("30 本目を開いて e を押すと、まだ読み込んでいない時系列の 31 本目が開く", async ({ page }) => {
    const folder = "E2E 時系列の続き";
    await page.setViewportSize(PC);
    await openTimeline(page, folder);
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await expect(card(page, `${folder} 31`)).toHaveCount(0);

    await card(page, `${folder} 30`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 30`);
    await page.keyboard.press("e");
    await expect(heading(page)).toHaveText(`${folder} 31`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&v=t$/);
  });

  test("記事を開いたまま横の一覧の「サイト別」を押すと、記事が閉じてボードが全幅で出る", async ({ page }) => {
    const folder = "E2E 時系列から閉じる";
    await page.setViewportSize(BESIDE);
    await openTimeline(page, folder);
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    // The timeline stays beside the article.
    await expect(card(page, `${folder} 2`)).toBeVisible();
    await expect(byTime(page)).toHaveAttribute("aria-current", "page");

    await byBoard(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(heading(page)).toHaveCount(0);
    await expect(column(page, `${folder} A`)).toBeVisible();
    const pane = await page.locator("[data-list-pane]").boundingBox();
    expect(pane!.width).toBeGreaterThan(BESIDE.width - 20);
  });

  test("一度時系列にすると、ページとして読み込んだ `/` は時系列に置き換わり、戻るでボードに戻らない。ボードにすれば `/` はボードのまま", async ({ page }) => {
    await page.goto("/?v=t");
    await expect(list(page)).toBeVisible();

    await page.goto("/feeds");
    await page.goto("/");
    await expect(page).toHaveURL(/\/\?v=t$/);
    await expect(list(page)).toBeVisible();
    await expect(byTime(page)).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(/\/feeds$/);

    await page.goto("/?v=t");
    await byBoard(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-feed]").first()).toBeVisible();
    await page.goto("/");
    await expect(page.locator("[data-feed]").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/$/);
    await expect(byBoard(page)).toHaveAttribute("aria-current", "page");
  });

  test("時系列でフォルダを選んだ画面の「新着」とロゴは時系列の「すべて」に行き、その後の `/` も時系列のまま", async ({ page }) => {
    await page.setViewportSize(PC);
    await homeStaysOnTimeline(page);
  });

  test("時系列から開いた記事の横の一覧で「新着」を押すと、記事が閉じて時系列の「すべて」が出る", async ({ page }) => {
    const folder = "E2E 時系列から新着";
    await page.setViewportSize(BESIDE);
    await openTimeline(page, folder);
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&v=t$/);
    await inboxTab(page).click();
    await expectAllTimeline(page);
  });

  test("ボードの「新着」とロゴは今のまま `/` のボード。時系列で「サイト別」にすると `/` はボードのまま", async ({ page }) => {
    const folder = "E2E 時系列";
    await page.setViewportSize(PC);
    for (const link of [inboxTab, logo]) {
      await openTab(page, folder);
      await link(page).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator("[data-feed]").first()).toBeVisible();
      await expect(byBoard(page)).toHaveAttribute("aria-current", "page");
    }

    await openTimeline(page, folder);
    await byBoard(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(column(page, `${folder} A`)).toBeVisible();
    await page.goto("/");
    await expect(page.locator("[data-feed]").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/$/);
    await expect(byBoard(page)).toHaveAttribute("aria-current", "page");
  });

  test("別のタブで時系列にしても、表示中のボードは router.refresh() でボードのまま", async ({ page, context }) => {
    const folder = "E2E 時系列と別のタブ";
    await openTab(page, folder);
    const other = await context.newPage();
    await other.goto("/?v=t");
    await expect(list(other)).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("inbox-view"))).toBe("timeline");

    // A column's 「すべて既読」 refreshes the router.
    await column(page, `${folder} A`).getByRole("button", { name: "すべて既読" }).click();
    await expect(page.getByRole("status")).toContainText("既読にしました");
    await expect(column(page, `${folder} A`).getByLabel("未読 0 本")).toBeAttached();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(column(page, `${folder} B`)).toBeVisible();
    await expect(byBoard(page)).toHaveAttribute("aria-current", "page");
  });

  test("オフラインで時系列のカードの「スキップ」を押すと、カードが戻りトーストが出る。通信が戻ればもう一度押せる", async ({ page, context }) => {
    const folder = "E2E 時系列でスキップ失敗";
    await openTimeline(page, folder);
    await context.setOffline(true);
    await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
    await expect(failed(page)).toBeVisible();
    await expect(card(page, `${folder} 1`)).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);

    await context.setOffline(false);
    await card(page, `${folder} 1`).getByRole("button", { name: "スキップ" }).click();
    await expect(page.getByRole("status")).toContainText("スキップしました");
    await expect(card(page, `${folder} 1`)).toHaveCount(0);
  });

  test("時系列から開いた記事の open は source=timeline、時系列のカードのスキップは screen=timeline で送られる", async ({ page }) => {
    const folder = "E2E 時系列の記録";
    await page.setViewportSize(BESIDE);
    await openTimeline(page, folder);
    const isActivity = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/activity";
    const sent = (type: string) =>
      page
        .waitForRequest((r) => isActivity(r) && JSON.parse(r.postData() ?? "null")?.type === type)
        .then((r) => JSON.parse(r.postData()!));

    let open = sent("open");
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    expect(await open).toMatchObject({ type: "open", source: "timeline", screen: "article" });

    // From the timeline beside the article, too.
    open = sent("open");
    await card(page, `${folder} 2`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    expect(await open).toMatchObject({ type: "open", source: "timeline" });

    const skip = sent("skip");
    await card(page, `${folder} 3`).getByRole("button", { name: "スキップ" }).click();
    expect(await skip).toMatchObject({ type: "skip", screen: "timeline", viewId: null, props: { via: "button" } });

    // On the timeline itself.
    await page.getByRole("link", { name: "戻る", exact: true }).or(page.getByRole("button", { name: "記事を閉じる" })).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&v=t$/);
    const skipHere = sent("skip");
    await card(page, `${folder} 4`).getByRole("button", { name: "スキップ" }).click();
    expect(await skipHere).toMatchObject({ type: "skip", screen: "timeline" });
  });
});

test("時系列のフォルダの「すべて既読」は止まったフィードの未読を残す。「N 本」は数えたままで、ボードの「すべて既読」は止まったフィードも既読にする", async ({ page, context }) => {
  // Two unread of a running feed, one of a paused feed and one of a failing feed.
  const folder = "E2E 時系列ですべて既読";
  const running = "E2E 時系列すべて 動く";
  const markAll = page.getByRole("button", { name: "すべて既読" });
  const toast = page.getByRole("status");
  const empty = page.getByText("止まっているフィードに未読が 2 本あります。");
  await openTimeline(page, folder);
  await expect(unread(page)).toHaveText("4 本");
  await expect(list(page).getByRole("listitem")).toHaveCount(2);

  // Offline: nothing is saved, and the cards and the count stay.
  await context.setOffline(true);
  await markAll.click();
  await expect(failed(page)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  await expect(unread(page)).toHaveText("4 本");
  await context.setOffline(false);

  // Only the two it shows; the count still has the stopped feeds', as the Board's does.
  await markAll.click();
  await expect(toast).toContainText("2 本を既読にしました");
  await expect(empty).toBeVisible();
  await expect(unread(page)).toHaveText("2 本");

  // 「元に戻す」 brings back the two it marked, and nothing else changes.
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(card(page, `${running} 1`)).toBeVisible();
  await expect(card(page, `${running} 2`)).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  await expect(unread(page)).toHaveText("4 本");

  await markAll.click();
  await expect(toast).toContainText("2 本を既読にしました");
  await expect(empty).toBeVisible();

  // The stopped feeds' unread wait behind 止まっているフィード on the Board.
  await byBoard(page).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  const stopped = page.getByRole("region", { name: "止まっているフィード" });
  await expect(stopped.getByRole("listitem").filter({ hasText: "E2E 時系列すべて 止めた" })).toContainText("未読 1 本");
  await expect(stopped.getByRole("listitem").filter({ hasText: "E2E 時系列すべて エラー" })).toContainText("未読 1 本");
  await expect(unread(page)).toHaveText("2 本");

  // The Board's 「すべて既読」 for the folder marks them too.
  await page.getByRole("main").getByRole("button", { name: "すべて既読" }).first().click();
  await expect(toast).toContainText("2 本を既読にしました");
  // The feeds stay listed, with no unread left.
  await expect(stopped.getByRole("listitem")).toHaveCount(2);
  await expect(stopped).not.toContainText("未読");
});

test.describe("スマホ幅 @mobile", () => {
  /** Scrolls the timeline well down and opens `title`; answers where the list was. */
  async function openFromScrolled(page: Page, title: string) {
    await card(page, title).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const listY = await scrollY(page);
    expect(listY).toBeGreaterThan(300);
    await card(page, title).getByRole("link").click();
    await expect(heading(page)).toHaveText(title);
    await expect.poll(() => scrollY(page)).toBe(0);
    return listY;
  }

  async function expectListAt(page: Page, y: number, tolerance: number) {
    await expect(list(page)).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?f=\d+&v=t$/);
    await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(tolerance);
  }

  test("時系列でフォルダを選んだ画面の「新着」とロゴは時系列の「すべて」に行き、その後の `/` も時系列のまま @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await homeStaysOnTimeline(page);
  });

  test("時系列のカードから ← で戻ると元の位置に戻りカードは薄く残る。読了 / スキップで戻るとカードは無い @mobile", async ({ page }) => {
    const folder = "E2E 時系列のスマホ";
    await openTimeline(page, folder);
    await expect(list(page).getByRole("listitem")).toHaveCount(16);

    let listY = await openFromScrolled(page, `${folder} 10`);
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expectListAt(page, listY, 2);
    await expect(card(page, `${folder} 10`)).toHaveAttribute("data-seen", "");

    listY = await openFromScrolled(page, `${folder} 12`);
    await page.getByRole("button", { name: "読了にする" }).click();
    // The read card leaves the list, so allow about one card of drift.
    await expectListAt(page, listY, 250);
    await expect(card(page, `${folder} 12`)).toHaveCount(0);

    listY = await openFromScrolled(page, `${folder} 14`);
    await page.getByRole("button", { name: "スキップ" }).click();
    await expectListAt(page, listY, 250);
    await expect(card(page, `${folder} 14`)).toHaveCount(0);
  });

  test("iPhone 横向きでは時系列は一覧のペインと空のペインで出て、幅 320px でも横にはみ出さない @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openTimeline(page, "E2E 時系列");
    await expect(page.locator("[data-feed]")).toHaveCount(0);
    const pane = await page.locator("[data-list-pane]").boundingBox();
    expect(pane!.width).toBeLessThan(400);
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。", { exact: false })).toBeVisible();
    for (const control of [byBoard(page), byTime(page), page.getByRole("switch", { name: "既読を含む" }), unread(page)]) {
      await expect(control).toBeInViewport();
    }
    expect(await sideOverflows(page)).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    await expect(byTime(page)).toBeVisible();
    await expect(unread(page)).toBeVisible();
    expect(await sideOverflows(page)).toEqual([]);
  });
});
