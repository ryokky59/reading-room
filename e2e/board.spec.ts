import { expect, test, type Page } from "@playwright/test";

// The Board at `/`: a column per feed, grouped by folder. Rows are at the end of e2e/seed.mts,
// one folder per test that changes state.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const tab = (page: Page, label: string, count: number | string = "\\d+") =>
  folderNav(page).getByRole("link", { name: new RegExp(`^${label}\\s*${count}$`) });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const rows = (page: Page, name: string) => column(page, name).getByRole("list").getByRole("listitem");
const row = (page: Page, name: string, title: string) => rows(page, name).filter({ hasText: title });
const unreadIn = (page: Page, name: string) => column(page, name).getByLabel(/^未読 \d+ 本$/);
const markAll = (page: Page, name: string) => column(page, name).getByRole("button", { name: "すべて既読" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const feedList = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const card = (page: Page, title: string) =>
  feedList(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const boardLink = (page: Page) => page.getByRole("link", { name: "‹ ボード" });
const stopped = (page: Page) => page.getByRole("region", { name: "止まっているフィード" });
const failed = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const overflowsX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

// A slow CPU (heavy PC, iPad, phone on its side): effects run late, after a quick back / forward.
async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

async function openTab(page: Page, label: string) {
  await page.goto("/");
  await tab(page, label).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(tab(page, label)).toHaveAttribute("aria-current", "page");
}

test.describe("PC 幅", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("フォルダごとに列が横に並び、列ヘッダーと要約、未読のない列、50 本の上限が正しい", async ({ page }) => {
    await page.goto("/");
    // Grouped in folder order, side by side, and the row of groups scrolls sideways.
    const first = (await page.getByRole("region", { name: "E2E ボード", exact: true }).boundingBox())!;
    const second = (await page.getByRole("region", { name: "E2E ボードで開く", exact: true }).boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
    expect(await overflowsX(page)).toBe(false);

    await tab(page, "E2E ボード").click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(column(page, "E2E 開く A")).toHaveCount(0);

    const many = column(page, "E2E 列 たくさん");
    await expect(many).toBeVisible();
    await expect(many.getByRole("link", { name: "E2E 列 たくさん", exact: true })).toBeVisible();
    await expect(unreadIn(page, "E2E 列 たくさん")).toHaveText("55");
    await expect(markAll(page, "E2E 列 たくさん")).toBeVisible();
    expect((await many.boundingBox())!.width).toBe(260);
    // The AI summary shows on the first row only.
    await expect(rows(page, "E2E 列 たくさん").first()).toContainText("AI 要約");
    await expect(many.getByText("AI 要約", { exact: true })).toHaveCount(1);
    // The 3 rows of a phone's section are not the limit here: 50, then a link to the list.
    await expect(rows(page, "E2E 列 たくさん")).toHaveCount(50);
    await expect(rows(page, "E2E 列 たくさん").nth(49)).toBeAttached();
    const more = many.getByRole("link", { name: "あと 5 件 ›" });
    await expect(more).toBeVisible();

    // A column scrolls on its own: the row of columns and the page stay.
    const list = many.getByRole("list");
    await list.evaluate((el) => (el.scrollTop = 400));
    expect(await list.evaluate((el) => el.scrollTop)).toBe(400);
    expect(await column(page, "E2E 列 少ない").getByRole("list").evaluate((el) => el.scrollTop)).toBe(0);
    expect(await scrollY(page)).toBe(0);

    // English titles are tagged.
    await expect(row(page, "E2E 列 少ない", "E2E 列 少ない 1")).toContainText("英→日");
    await expect(row(page, "E2E 列 少ない", "E2E 列 少ない 2")).toContainText("対話中");
    // A column with nothing unread is faded, to the right of the others in its group.
    await expect(column(page, "E2E 列 未読なし")).toHaveCSS("opacity", "0.6");
    const none = (await column(page, "E2E 列 未読なし").boundingBox())!;
    expect(none.x).toBeGreaterThan((await column(page, "E2E 列 少ない").boundingBox())!.x);
    // Its seen articles are one tap away, not a redirect back here.
    await column(page, "E2E 列 未読なし").getByRole("link", { name: "E2E 列 未読なし", exact: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+&a=1$/);
    await expect(card(page, "E2E 列 未読なし 1")).toHaveAttribute("data-seen", "");
  });

  test("止めたフィードと取得エラーのフィードは「止まっているフィード」に状態つきで出て、列には出ない", async ({ page }) => {
    await openTab(page, "E2E ボード");
    await expect(stopped(page)).toBeVisible();
    const paused = stopped(page).getByRole("listitem").filter({ hasText: "E2E 列 止めた" });
    const broken = stopped(page).getByRole("listitem").filter({ hasText: "E2E 列 エラー" });
    await expect(paused).toContainText("止めています");
    await expect(paused).toContainText("未読 1 本");
    await expect(broken).toContainText("取得エラー");
    await expect(column(page, "E2E 列 止めた")).toHaveCount(0);
    await expect(column(page, "E2E 列 エラー")).toHaveCount(0);
    await expect(page.getByText("E2E 列 止めた 1")).toHaveCount(0);
    await expect(stopped(page).getByRole("link", { name: /フィード管理/ })).toHaveAttribute("href", "/feeds");

    // Their unread articles can still be read.
    await paused.getByRole("link").click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    await expect(card(page, "E2E 列 止めた 1")).toBeVisible();
    // Another folder's stopped feeds stay out of this one's tab.
    await openTab(page, "E2E ボードで開く");
    await expect(stopped(page)).toHaveCount(0);
  });

  test("見出しを押すと記事が開き、左はそのフィードだけで j / k はその中で動く。戻るとボードに戻り、薄く残る", async ({ page }) => {
    await slowCpu(page);
    await page.goto("/");
    await row(page, "E2E 開く A", "E2E 開く A 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 開く A 1");
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    await expect(feedList(page).getByRole("listitem")).toHaveCount(3);
    await expect(card(page, "E2E 開く A 1")).toHaveAttribute("aria-current", "true");
    await expect(card(page, "E2E 開く B 1")).toHaveCount(0);
    const articleUrl = page.url();

    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E 開く A 2");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E 開く A 3");
    // The last one of the feed: j goes nowhere else.
    await page.keyboard.press("j");
    await page.waitForTimeout(300);
    await expect(heading(page)).toHaveText("E2E 開く A 3");
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText("E2E 開く A 2");

    // ← leads to the Board it came from, where the opened rows stay, faded, until a full load.
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);
    await expect(row(page, "E2E 開く A", "E2E 開く A 1")).toHaveAttribute("data-seen", "");
    await expect(row(page, "E2E 開く A", "E2E 開く A 2")).toHaveAttribute("data-seen", "");
    await expect(unreadIn(page, "E2E 開く A")).toHaveText("0");
    await expect(column(page, "E2E 開く B")).toBeVisible();

    // Browser back and forward, and opening the URL directly.
    await page.goBack();
    await expect(heading(page)).toHaveText("E2E 開く A 2");
    await page.goForward();
    await expect(page).toHaveURL("/");
    await expect(column(page, "E2E 開く A")).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    // A late replace from the article left behind would bring the article back.
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);
    await page.goto(articleUrl);
    await expect(heading(page)).toHaveText("E2E 開く A 1");
    await expect(card(page, "E2E 開く A 1")).toHaveAttribute("aria-current", "true");
    await expect(card(page, "E2E 開く B 1")).toHaveCount(0);
    await page.reload();
    await expect(heading(page)).toHaveText("E2E 開く A 1");
    // Without a Board to go back to, ← goes to the feed the URL names.
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+(&s=\d+)?(&a=1)?$/);

    // A full load drops the seen rows.
    await page.goto("/");
    await expect(rows(page, "E2E 開く A").filter({ hasText: "E2E 開く A 1" })).toHaveCount(0);
  });

  test("列の「すべて既読」で列が空になり未読数が減る。ほかの列の薄い行は残る", async ({ page }) => {
    await openTab(page, "E2E ボードで既読");
    await expect(tab(page, "E2E ボードで既読", 4)).toBeVisible();
    // A seen row kept in another column, and one in the column about to be cleared.
    await row(page, "E2E 既読 B", "E2E 既読 B 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 既読 B 1");
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(tab(page, "E2E ボードで既読", 3)).toBeVisible();
    await row(page, "E2E 既読 A", "E2E 既読 A 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 既読 A 1");
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(tab(page, "E2E ボードで既読", 2)).toBeVisible();

    await markAll(page, "E2E 既読 A").click();
    await expect(tab(page, "E2E ボードで既読", 1)).toBeVisible();
    await expect(unreadIn(page, "E2E 既読 A")).toHaveText("0");
    await expect(rows(page, "E2E 既読 A")).toHaveText(["未読はありません"]);
    await expect(markAll(page, "E2E 既読 A")).toHaveCount(0);
    await expect(row(page, "E2E 既読 B", "E2E 既読 B 1")).toHaveAttribute("data-seen", "");

    await page.reload();
    await expect(tab(page, "E2E ボードで既読", 1)).toBeVisible();
    await expect(rows(page, "E2E 既読 B")).toHaveCount(1);
  });

  test("列の「すべて既読」が保存できなければメッセージが出て、もう一度押せる", async ({ page }) => {
    await openTab(page, "E2E ボードで失敗");
    await page.route("**/*", (route) =>
      "next-action" in route.request().headers() ? route.abort() : route.fallback(),
    );
    await markAll(page, "E2E 失敗の列").click();
    await expect(failed(page)).toBeVisible();
    await expect(rows(page, "E2E 失敗の列")).toHaveCount(2);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);

    await page.unrouteAll();
    await markAll(page, "E2E 失敗の列").click();
    await expect(unreadIn(page, "E2E 失敗の列")).toHaveText("0");
  });

  test("フォルダの「すべて既読」は選んだフォルダのときだけ出る。未分類の列は「URL から追加」で、そこだけ既読にする", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("button", { name: "すべて既読" }).first()).toBeVisible();
    await tab(page, "未分類").click();
    await expect(page).toHaveURL("/?f=none");
    const fromUrl = column(page, "URL から追加");
    await expect(row(page, "URL から追加", "本番で動くエージェント")).toBeVisible();
    const before = Number(await unreadIn(page, "URL から追加").textContent());
    expect(before).toBeGreaterThan(0);

    // The articles have no feed, so they open and list as 未分類.
    await row(page, "URL から追加", "本番で動くエージェント").getByRole("link").click();
    await expect(heading(page)).toHaveText("本番で動くエージェント");
    await expect(page).toHaveURL(/\/articles\/\d+\?f=none$/);
    await expect(feedList(page).getByRole("link").first()).toBeVisible();
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL("/?f=none");
    await expect(unreadIn(page, "URL から追加")).toHaveText(String(before - 1));

    await fromUrl.getByRole("button", { name: "すべて既読" }).click();
    // With no rows left, the column goes; a feed's column would stay, but this one has no feed.
    await expect(fromUrl).toHaveCount(0);
    // The feed beside it, unfiled too, keeps its unread.
    await expect(unreadIn(page, "E2E 未分類の列")).toHaveText("1");
    await expect(tab(page, "未分類", 1)).toHaveAttribute("aria-current", "page");
  });

  test("未読が止まっているフィードにしかなければ、「未読の記事はありません」とは出さない", async ({ page }) => {
    await openTab(page, "E2E 止まりだけ");
    await expect(page.getByText(/^1 本/)).toBeVisible();
    await expect(page.getByText(/未読の記事はありません/)).toHaveCount(0);
    await expect(page.getByText("止まっているフィードに未読が 1 本あります。")).toBeVisible();
  });

  test("「既読を含む」は一覧に切り替わり、切ればボードに戻る", async ({ page }) => {
    await openTab(page, "E2E ボード");
    const url = page.url();
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(page).toHaveURL(`${url}&a=1`);
    await expect(card(page, "E2E 列 たくさん 1")).toBeVisible();
    await expect(column(page, "E2E 列 たくさん")).toHaveCount(0);
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(page).toHaveURL(url);
    await expect(column(page, "E2E 列 たくさん")).toBeVisible();
  });

  test("「あと N 件」でフィードの一覧になり、ヒーローが出て、「‹ ボード」で元のタブに戻る", async ({ page }) => {
    await openTab(page, "E2E ボード");
    const url = page.url();
    await column(page, "E2E 列 たくさん").getByRole("link", { name: "あと 5 件 ›" }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "E2E 列 たくさん", exact: true, level: 2 })).toBeVisible();
    await expect(main.getByText("E2E ボード", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^55 本/)).toBeVisible();
    await expect(page.getByRole("button", { name: "すべて既読" })).toBeVisible();
    await expect(folderNav(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "サイト" })).toHaveCount(0);
    await expect(feedList(page).getByRole("listitem")).toHaveCount(30);

    await boardLink(page).click();
    await expect(page).toHaveURL(url);
    await expect(column(page, "E2E 列 たくさん")).toBeVisible();

    // Without a Board in this visit, 「‹ ボード」 goes to the whole Board.
    await column(page, "E2E 列 少ない").getByRole("link", { name: "E2E 列 少ない", exact: true }).click();
    await expect(boardLink(page)).toBeVisible();
    await page.reload();
    await boardLink(page).click();
    await expect(page).toHaveURL("/");

    // With an article open, it closes the article too.
    await page.goto(url);
    await row(page, "E2E 列 少ない", "E2E 列 少ない 2").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 列 少ない 2");
    await boardLink(page).click();
    await expect(page).toHaveURL(url);
    await expect(heading(page)).toHaveCount(0);
    await expect(column(page, "E2E 列 たくさん")).toBeVisible();
  });

  test("ヘッダーに「今すぐ取得」「URL を追加」「N 分前に取得」が出て、ボードには j が効かない", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner").first();
    await expect(header.getByRole("button", { name: "今すぐ取得" })).toBeVisible();
    await expect(header.getByRole("button", { name: "URL を追加" })).toBeVisible();
    await expect(header.getByText(/(分前|時間前|たった今)に取得$/)).toBeVisible();
    await page.keyboard.press("j");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL("/");
  });

  test("ボードから開いた記事で一覧が届く前に j / k / 読了を押しても、別のフィードへ移らない", async ({ page }) => {
    // Holds the feed list back, as a slow connection does, until the test lets it through.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/articles\/\d+\/list/, async (route) => {
      await held;
      await route.fallback().catch(() => {});
    });
    const main = page.getByRole("main");

    await openTab(page, "E2E 遅い一覧");
    await row(page, "E2E 遅い B", "E2E 遅い B 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 遅い B 1");
    await page.keyboard.press("k"); // Would be the last row of A.
    await page.waitForTimeout(300);
    await expect(heading(page)).toHaveText("E2E 遅い B 1");
    await expect(feedList(page)).toHaveCount(0);

    await openTab(page, "E2E 遅い一覧");
    const lastRow = rows(page, "E2E 遅い A").nth(49);
    await expect(lastRow).toContainText("E2E 遅い A 50");
    await lastRow.getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 遅い A 50");
    await page.keyboard.press("j"); // Would be the first row of B.
    await page.waitForTimeout(300);
    await expect(heading(page)).toHaveText("E2E 遅い A 50");
    await expect(feedList(page)).toHaveCount(0);

    // Past the column's 50 rows, 読了 goes on in the same feed.
    // Pressed before the list arrives. The lookup of the next article then waits for the list's
    // navigation in the router's queue, so the list is let through right after the press.
    await main.getByRole("button", { name: "読了にする" }).click();
    release();
    await expect(heading(page)).toHaveText("E2E 遅い A 51");
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    // The list that arrives is that feed's (it loads 30 cards, so not as far as 51).
    await expect(card(page, "E2E 遅い A 1")).toBeVisible();
    await expect(card(page, "E2E 遅い B 1")).toHaveCount(0);
  });

  test("列の「すべて既読」で、50 本より後の開いた行も列に残らない", async ({ page }) => {
    await openTab(page, "E2E 五十本を越える");
    const url = page.url();
    await column(page, "E2E 五十二本").getByRole("link", { name: "E2E 五十二本", exact: true }).click();
    await page.getByRole("link", { name: /もっと見る/ }).click();
    await card(page, "E2E 五十二本 52").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 五十二本 52");
    await boardLink(page).click();
    await expect(page).toHaveURL(url);
    await expect(unreadIn(page, "E2E 五十二本")).toHaveText("51");

    await markAll(page, "E2E 五十二本").click();
    await expect(unreadIn(page, "E2E 五十二本")).toHaveText("0");
    await expect(rows(page, "E2E 五十二本")).toHaveText(["未読はありません"]);
  });

  test("ボードから開いた記事を一覧のカードで「未読に戻す」と、ボードに戻る", async ({ page }) => {
    await openTab(page, "E2E ボードから戻す");
    const url = page.url();
    await row(page, "E2E 戻す列", "E2E 戻す列 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 戻す列 1");
    await card(page, "E2E 戻す列 1").getByRole("button", { name: "未読に戻す" }).click();
    await expect(page).toHaveURL(url);
    await expect(unreadIn(page, "E2E 戻す列")).toHaveText("2");
    await expect(row(page, "E2E 戻す列", "E2E 戻す列 1")).not.toHaveAttribute("data-seen", "");
  });

  test("ファビコンは取れたときだけ出て、失敗の形によらず頭文字になる。ブラウザは外へ出ない", async ({ page }) => {
    const hosts: string[] = [];
    page.on("request", (r) => hosts.push(new URL(r.url()).hostname));
    const badge = (name: string) => column(page, name).locator("header span[aria-hidden]");

    await openTab(page, "E2E ファビコン");
    await expect(badge("E2E 画像あり").locator("img")).toBeVisible();
    await expect.poll(() => badge("E2E 画像あり").locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    // A 404 whose body is an image, as DuckDuckGo sends, and an empty 200.
    for (const name of ["E2E 画像 404", "E2E 画像 空"]) {
      await expect(badge(name).locator("img")).toHaveCount(0);
      await expect(badge(name)).toHaveText("E");
    }
    // No answer at all: nothing hides the initial meanwhile, and it stays when the request gives up.
    const waiting = badge("E2E 画像 無応答").locator("img");
    await expect(waiting).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(waiting).toHaveCount(0, { timeout: 10_000 });
    await expect(badge("E2E 画像 無応答")).toHaveText("E");

    // The hero shows it too.
    await column(page, "E2E 画像あり").getByRole("link", { name: "E2E 画像あり", exact: true }).click();
    await expect(page).toHaveURL(/&s=\d+$/);
    await expect(page.getByRole("main").locator("img")).toBeVisible();

    expect(new Set(hosts)).toEqual(new Set(["localhost"]));

    // Only a host name reaches the service.
    expect((await page.request.get("/api/favicon/a%2Fb")).status()).toBe(404);
  });
});

for (const viewport of [
  { width: 669, height: 825 }, // an unfolded phone
  { width: 951, height: 543 }, // an unfolded phone on its side
]) {
  test.describe(`横に並ぶ幅 ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("列が横に並び、ページは横にはみ出さず、記事を開くと一覧が横に出る", async ({ page }) => {
      await openTab(page, "E2E ボード");
      await expect(column(page, "E2E 列 たくさん")).toBeVisible();
      const few = (await column(page, "E2E 列 少ない").boundingBox())!;
      expect(few.y).toBe((await column(page, "E2E 列 たくさん").boundingBox())!.y);
      expect(await overflowsX(page)).toBe(false);
      // A column ends inside the screen and scrolls on its own, however short the screen.
      const many = (await column(page, "E2E 列 たくさん").boundingBox())!;
      expect(many.y + many.height).toBeLessThanOrEqual(viewport.height);

      await row(page, "E2E 列 たくさん", "E2E 列 たくさん 1").first().getByRole("link").click();
      await expect(heading(page)).toBeVisible();
      await expect(feedList(page).getByRole("listitem")).toHaveCount(30);
      expect(await overflowsX(page)).toBe(false);
    });
  });
}

test.describe("横向きのスマホ 844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("縦積みになり、「URL を追加」を開いても読める高さが残る", async ({ page }) => {
    await openTab(page, "E2E ボード");
    const many = column(page, "E2E 列 たくさん");
    await expect(many.getByRole("list").getByRole("listitem")).toHaveCount(3);
    await expect(many.getByRole("link", { name: /^もっと見る\(あと \d+ 件\)›$/ })).toBeVisible();
    const few = (await column(page, "E2E 列 少ない").boundingBox())!;
    const box = (await many.boundingBox())!;
    expect(few.x).toBe(box.x);
    expect(few.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(await overflowsX(page)).toBe(false);

    await page.getByRole("button", { name: "URL を追加" }).click();
    await expect(page.getByPlaceholder("https://…")).toBeVisible();
    const pane = page.getByRole("main");
    expect(await pane.evaluate((el) => el.clientHeight)).toBeGreaterThan(150);
    await column(page, "E2E 列 少ない").scrollIntoViewIfNeeded();
    await expect(column(page, "E2E 列 少ない")).toBeInViewport();
    expect(await overflowsX(page)).toBe(false);
  });
});

test("狭い幅で記事を開いたまま広げると、左に一覧が届いて j が効く", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("/");
  await row(page, "E2E 広げて一覧", "E2E 広げて一覧 1").getByRole("link").click();
  await expect(heading(page)).toHaveText("E2E 広げて一覧 1");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(card(page, "E2E 広げて一覧 1")).toHaveAttribute("aria-current", "true");
  await expect(feedList(page).getByRole("listitem")).toHaveCount(2);
  await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText("E2E 広げて一覧 2");
});

test.describe("横向きのスマホ 844×390 @mobile", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("ボードから開いて「戻る」のあと、ブラウザの戻る→進むでボードが出る @mobile", async ({ page }) => {
    await slowCpu(page);
    await page.goto("/");
    await row(page, "E2E 横向きで開く", "E2E 横向きで開く 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 横向きで開く 1");
    await expect(card(page, "E2E 横向きで開く 1")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E 横向きで開く 2");
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);

    await page.goBack();
    await expect(heading(page)).toHaveText("E2E 横向きで開く 2");
    await page.goForward();
    await expect(page).toHaveURL("/");
    await expect(column(page, "E2E 横向きで開く")).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);
  });
});

test.describe("スマホ @mobile", () => {
  test("フィードごとに見出し 3 本と「もっと見る」が出て、そのフィードの一覧になり、「‹ ボード」で戻れる @mobile", async ({ page }) => {
    await openTab(page, "E2E ボードのスマホ");
    const section = column(page, "E2E スマホの列");
    await expect(section.getByRole("list").getByRole("listitem")).toHaveCount(3);
    await expect(section.getByText("AI 要約", { exact: true })).toHaveCount(1);
    expect(await overflowsX(page)).toBe(false);

    await section.getByRole("link", { name: "もっと見る(あと 2 件)›" }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    await expect(feedList(page).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "E2E スマホの列", exact: true, level: 2 })).toBeVisible();
    expect(await overflowsX(page)).toBe(false);

    await boardLink(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(column(page, "E2E スマホの列")).toBeVisible();
  });

  test("未読のないフィードは出ず、止まっているフィードは一番下に畳まれる @mobile", async ({ page }) => {
    await openTab(page, "E2E ボード");
    await expect(column(page, "E2E 列 たくさん").getByRole("list").getByRole("listitem")).toHaveCount(3);
    await expect(column(page, "E2E 列 未読なし")).toBeHidden();
    await expect(column(page, "E2E 列 止めた")).toHaveCount(0);

    const folded = page.locator("details");
    await expect(folded.getByRole("link", { name: "E2E 列 止めた" })).toBeHidden();
    await folded.getByText("止まっているフィード").click();
    await expect(folded.getByRole("listitem").filter({ hasText: "E2E 列 止めた" })).toContainText("止めています");
    await expect(folded.getByRole("listitem").filter({ hasText: "E2E 列 エラー" })).toContainText("取得エラー");
    await expect(folded.getByRole("link", { name: /フィード管理/ })).toBeVisible();
    const box = (await folded.boundingBox())!;
    expect(box.y).toBeGreaterThan((await column(page, "E2E 列 少ない").boundingBox())!.y);
    expect(await overflowsX(page)).toBe(false);
  });

  test("「今すぐ取得」「URL を追加」がヘッダーにあり、横にはみ出さない @mobile", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner").first();
    await expect(header.getByRole("button", { name: "今すぐ取得" })).toBeInViewport();
    await expect(header.getByRole("button", { name: "URL を追加" })).toBeInViewport();
    await header.getByRole("button", { name: "URL を追加" }).click();
    await expect(page.getByPlaceholder("https://…")).toBeInViewport();
    expect(await overflowsX(page)).toBe(false);
  });

  test("← で戻るとボードの位置に戻り、ブラウザの戻るでも同じ @mobile", async ({ page }) => {
    await page.goto("/");
    const target = rows(page, "E2E 列 たくさん").first();
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const y = await scrollY(page);
    expect(y).toBeGreaterThan(500);

    await target.getByRole("link").click();
    await expect(heading(page)).toBeVisible();
    await expect.poll(() => scrollY(page)).toBe(0);
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(column(page, "E2E 列 たくさん")).toBeVisible();
    await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2);

    await rows(page, "E2E 列 たくさん").first().getByRole("link").click();
    await expect(heading(page)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2);
  });

  test("列の最後の未読を開いて戻っても、セクションは薄い行で残り、下のセクションの位置が動かない @mobile", async ({ page }) => {
    await page.goto("/");
    await rows(page, "E2E 1 本の列").first().scrollIntoViewIfNeeded();
    const y = await scrollY(page);
    expect(y).toBeGreaterThan(500);
    const below = (await column(page, "E2E 下の列").boundingBox())!.y;

    await rows(page, "E2E 1 本の列").first().getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 1 本の列 1");
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(unreadIn(page, "E2E 1 本の列")).toHaveText("0");
    await expect(rows(page, "E2E 1 本の列").first()).toHaveAttribute("data-seen", "");
    await expect.poll(() => scrollY(page)).toBe(y);
    await expect.poll(async () => (await column(page, "E2E 下の列").boundingBox())?.y ?? -Infinity).toBe(below);

    // A full load drops the seen row, and the section with it.
    await page.reload();
    await expect(column(page, "E2E 1 本の列")).toBeHidden();
  });

  test("ボードから開いた記事を読了すると、ボードに戻って元に戻せる。もっと見るから開いた記事はフィードの一覧に戻る @mobile", async ({
    page,
  }) => {
    await openTab(page, "E2E ボードから読了");
    const url = page.url();
    await row(page, "E2E 読了の列", "E2E 読了の列 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 読了の列 1");
    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(page).toHaveURL(url);
    await expect(unreadIn(page, "E2E 読了の列")).toHaveText("1");
    await expect(row(page, "E2E 読了の列", "E2E 読了の列 1")).toHaveCount(0);

    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(unreadIn(page, "E2E 読了の列")).toHaveText("2");
    await expect(row(page, "E2E 読了の列", "E2E 読了の列 1")).toBeVisible();

    // A later refresh still reaches the Board: nothing is left waiting for a card to leave.
    await column(page, "E2E 読了の列").getByRole("link", { name: "E2E 読了の列", exact: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    await card(page, "E2E 読了の列 2").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 読了の列 2");
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    await expect(card(page, "E2E 読了の列 1")).toBeVisible();
  });
});
