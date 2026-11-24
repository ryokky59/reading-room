import { expect, test, type Locator, type Page, type Route } from "./test";
import { openFeed } from "./nav";

// PCs (`lg` and up): the article is a sheet over the list or the Board, with the chat as its
// column from `xl`. From `split` up to `lg` the list stays beside the article.
// Folders used here are seeded at the end of e2e/seed.mts; tests that read or skip use their own.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) => list(page).getByRole("listitem").filter({ hasText: title });
const chat = (page: Page) => page.getByRole("complementary", { name: "AI と話す" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const feedTitle = (page: Page, name: string) => page.getByRole("heading", { name, exact: true, level: 2 });
/** The scrolling list pane around the cards. */
const pane = (page: Page) => list(page).locator("xpath=ancestor::div[@role][1]");
const scrollTop = (el: Locator) => el.evaluate((e) => e.scrollTop);

/** Marks the window; expectNoReload fails if a full page load has replaced it since. */
const markPage = (page: Page) => page.evaluate(() => Object.assign(window, { e2eMark: true }));
const expectNoReload = async (page: Page) =>
  expect(await page.evaluate(() => "e2eMark" in window)).toBe(true);

// Only the list pane renders InboxNavSync, so its client reference marks the list in the HTML and
// in the RSC payload alike (an ASCII name, as the payload comes without a charset).
const hasList = (body: string) => body.includes("InboxNavSync");

/**
 * Runs `act` and returns, for each client-side navigation it made (not prefetches), whether the
 * server's answer carried the list pane, so a test can see where the list was built. The answers
 * are fetched here, since the router may stop reading one once it has what it shows.
 */
async function serverLists(page: Page, act: () => Promise<void>) {
  let pending = 0;
  const seen: boolean[] = [];
  const handler = async (route: Route) => {
    const headers = route.request().headers();
    if (!("rsc" in headers) || "next-router-prefetch" in headers) return route.fallback();
    pending++;
    try {
      const response = await route.fetch();
      const body = await response.text();
      seen.push(hasList(body));
      await route.fulfill({ response, body }).catch(() => {}); // the router may have moved on
    } finally {
      pending--;
    }
  };
  await page.route("**/*", handler);
  await act();
  await expect.poll(() => pending).toBe(0);
  await page.unroute("**/*", handler);
  return seen;
}
const listsIn = (responses: boolean[]) => responses.filter(Boolean).length;
/** The HTML the server sends for a full load of `url`. */
const fullLoad = async (page: Page, url: string) => (await page.request.get(url)).text();

/** The folder in the list with 既読を含む (a=1): rows that other tests have opened stay listed. */
async function openWithSeen(page: Page, name: string) {
  await page.goto("/?a=1");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${name}\\s*\\d+$`) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
}

test.describe("PC 幅(一覧の上のシート)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("一覧から開いても一覧は全幅のまま後ろに残り、閉じるとスクロール位置と絞り込みが保たれる", async ({ page }) => {
    await openFeed(page, "E2E たくさん");
    const filtered = new URL(page.url()).search;
    // Marks the list's DOM: if switching articles re-rendered the pane, the mark would be gone.
    await list(page).evaluate((el) => (el.dataset.e2e = "kept"));

    await card(page, "量産記事 20").scrollIntoViewIfNeeded();
    const top = await scrollTop(pane(page));
    expect(top).toBeGreaterThan(0);

    await card(page, "量産記事 20").getByRole("link").click();
    await expect(heading(page)).toHaveText("量産記事 20");
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${filtered}$`));
    await expect(card(page, "量産記事 20")).toHaveAttribute("aria-current", "true");
    await expect(chat(page)).toBeVisible();
    // The list keeps the whole width under the sheet; the chat is a 380px column, not a drawer.
    await expect(page.getByRole("dialog", { name: "記事" })).toBeVisible();
    expect((await pane(page).boundingBox())!.width).toBe(1440);
    await expect.poll(async () => (await chat(page).boundingBox())?.x).toBe(1440 - 380);
    const column = (await chat(page).boundingBox())!;
    expect([column.x + column.width, column.width]).toEqual([1440, 380]);
    await expect(chat(page).getByRole("button", { name: "閉じる" })).toBeHidden();
    // The empty pane of narrower screens is not beside the list.
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(heading(page)).toHaveCount(0);
    expect(await scrollTop(pane(page))).toBe(top);
    expect((await pane(page).boundingBox())!.width).toBe(1440);
    await expect(list(page)).toHaveAttribute("data-e2e", "kept");
    await expect(card(page, "量産記事 20")).toHaveAttribute("data-seen", "");
    await expect(feedTitle(page, "E2E 量産サイト")).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(30);

    // Another card opens the sheet again; j moves on in the list behind it.
    await card(page, "量産記事 21").getByRole("link").click();
    await expect(heading(page)).toHaveText("量産記事 21");
    await expect(card(page, "量産記事 21")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("量産記事 22");
    await expect(card(page, "量産記事 22")).toHaveAttribute("aria-current", "true");
    await expect(list(page)).toHaveAttribute("data-e2e", "kept");
  });

  test("記事を切り替えると対話も切り替わる", async ({ page }) => {
    await page.goto("/?a=1");
    await card(page, "対話のある記事").getByRole("link").click();
    await expect(chat(page)).toContainText("要点は E2E テストが通ることです。");
    // The card just above it in the list.
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText("ビジネスの記事");
    await expect(chat(page)).not.toContainText("要点は E2E テストが通ることです。");
    await expect(chat(page).getByRole("button", { name: "要約してもらう" })).toBeVisible();
  });

  test("読了 / スキップで次の記事が開き、一覧から消える。次がなければフォルダのボード", async ({ page }) => {
    await openFeed(page, "E2E ペインで読む");
    const filtered = new URL(page.url()).search;
    await card(page, "E2E ペインで読む 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E ペインで読む 1");

    await page.getByRole("main").getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText("E2E ペインで読む 2");
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${filtered}$`));
    await expect(card(page, "E2E ペインで読む 1")).toHaveCount(0);
    await expect(card(page, "E2E ペインで読む 2")).toHaveAttribute("aria-current", "true");

    await page.getByRole("main").getByRole("button", { name: "スキップ" }).click();
    await expect(heading(page)).toHaveText("E2E ペインで読む 3");
    await expect(card(page, "E2E ペインで読む 2")).toHaveCount(0);

    await page.getByRole("main").getByRole("button", { name: "読了にする" }).click();
    await expect(page).toHaveURL(`/${filtered.replace(/&s=\d+$/, "")}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "E2E ペインで読むのサイト" }).getByLabel("未読 0 本")).toBeVisible();
  });

  test("読み込み済みの最後の記事で読了 / スキップすると、「もっと見る」の先の次の未読が開く", async ({ page }) => {
    await openFeed(page, "E2E 読み進める");
    const filtered = new URL(page.url()).search;
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await expect(card(page, "読み進める 31")).toHaveCount(0);

    await card(page, "読み進める 30").getByRole("link").click();
    await expect(heading(page)).toHaveText("読み進める 30");
    await page.getByRole("main").getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText("読み進める 31");
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${filtered}$`));
    await expect(card(page, "読み進める 30")).toHaveCount(0);
    await expect(card(page, "読み進める 31")).toHaveAttribute("aria-current", "true");

    // 31 is now the last loaded card; 32 is still behind 「もっと見る」.
    await expect(list(page).getByRole("listitem").last()).toContainText("読み進める 31");
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("読み進める 32");
    await expect(card(page, "読み進める 31")).toHaveCount(0);

    // Nothing unread is left after 32, though 1-29 are still above it: the sheet closes onto the list.
    await page.keyboard.press("e");
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "記事" })).toHaveCount(0);
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeHidden();
    await expect(list(page).getByRole("listitem")).toHaveCount(29);
  });

  test("記事の URL を直接開いてもシートの後ろに一覧が届き、戻るで前の記事に戻る", async ({ page }) => {
    await openFeed(page, "E2E 直接開く");
    const href = (await card(page, "E2E 直接開く 2").getByRole("link").getAttribute("href"))!;

    await page.goto(href);
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(card(page, "E2E 直接開く 2")).toHaveAttribute("aria-current", "true");
    await expect(feedTitle(page, "E2E 直接開くのサイト")).toBeVisible();
    await expect(chat(page)).toBeVisible();

    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E 直接開く 3");
    await page.goBack();
    await expect(page).toHaveURL(href);
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(card(page, "E2E 直接開く 2")).toHaveAttribute("aria-current", "true");

    // A reload starts the faded rows again (#112): 3, seen before it and not open, is gone.
    await page.reload();
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(list(page).getByRole("listitem")).toHaveCount(2);
    await expect(card(page, "E2E 直接開く 3")).toHaveCount(0);
  });

  test("j / k で移動、e で読了、s でスキップ。入力中は効かない", async ({ page }) => {
    await openFeed(page, "E2E キーボード");
    const filtered = new URL(page.url()).search;
    // Nothing beside the list; j still opens its first article.
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeHidden();

    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E キーボード 1");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E キーボード 2");
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText("E2E キーボード 1");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E キーボード 2");
    const url = page.url();

    const input = chat(page).getByPlaceholder("質問や感想を書く");
    await input.click();
    await page.keyboard.type("jkes");
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("jkes");
    await expect(page).toHaveURL(url);
    await expect(heading(page)).toHaveText("E2E キーボード 2");
    await input.fill("");
    await heading(page).click(); // leaves the input

    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("E2E キーボード 3");
    await expect(card(page, "E2E キーボード 2")).toHaveCount(0);
    await page.keyboard.press("e");
    // Nothing comes after 3, so the feed's list is left with no article beside it.
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(card(page, "E2E キーボード 3")).toHaveCount(0);
    await expect(card(page, "E2E キーボード 1")).toBeVisible();

    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E キーボード 1");
    await page.keyboard.press("e");
    await expect(page).toHaveURL(`/${filtered.replace(/&s=\d+$/, "")}`);
    await expect(heading(page)).toHaveCount(0);

    await page.goto("/read");
    for (const n of [1, 3]) await expect(page.getByText(`E2E キーボード ${n}`)).toBeVisible();
    await expect(page.getByText("E2E キーボード 2")).toHaveCount(0);
  });
});

// From `split` up to `lg` the list stays beside the open article; the chat is a drawer.
test.describe("一覧が記事の横に出る幅 1000×800", () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test("記事を開いたままチップや「もっと見る」を押すと一覧だけが切り替わり、記事と書きかけの対話が残る", async ({ page }) => {
    await page.goto("/?a=1");
    await card(page, "対話のある記事").getByRole("link").click();
    await expect(heading(page)).toHaveText("対話のある記事");
    const path = new URL(page.url()).pathname;
    // Found also while the drawer is closed (by role it would be hidden).
    const drawer = page.locator('aside[aria-label="AI と話す"]');
    const input = drawer.getByPlaceholder("質問や感想を書く");
    // The chat is a drawer here, closed again so that the list can be pressed.
    const draft = async () => {
      await page.getByRole("button", { name: "AI と話す" }).click();
      await input.fill("書きかけの質問");
      await drawer.getByRole("button", { name: "閉じる" }).click();
    };
    await draft();
    const kept = async () => {
      await expect(heading(page)).toHaveText("対話のある記事");
      await expect(input).toHaveValue("書きかけの質問");
      await expect(drawer).toContainText("要点は E2E テストが通ることです。");
    };

    await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&a=1$`));
    await expect(folderNav(page).getByRole("link", { name: /^E2E たくさん/ })).toHaveAttribute("aria-current", "page");
    await expect(list(page).getByRole("heading", { name: "量産記事 1", exact: true })).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await kept();

    await page.getByRole("link", { name: /もっと見る/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&n=60&a=1$`));
    await expect(list(page).getByRole("listitem")).toHaveCount(35);
    await kept();

    await folderNav(page).getByRole("link", { name: /^すべて/ }).click();
    await expect(page).toHaveURL(`${path}?a=1`);
    await expect(card(page, "対話のある記事")).toHaveAttribute("aria-current", "true");
    await kept();

    // The article URL now carries the list's filter: a reload shows both again.
    await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&a=1$`));
    const filtered = new URL(page.url()).search;
    await page.reload();
    await expect(heading(page)).toHaveText("対話のある記事");
    await expect(folderNav(page).getByRole("link", { name: /^E2E たくさん/ })).toHaveAttribute("aria-current", "page");
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    // The list-only URL the chips pass through also ends on the article when loaded directly.
    await page.goto(`${path}/list${filtered}`);
    await expect(page).toHaveURL(`${path}${filtered}`);
    await expect(heading(page)).toHaveText("対話のある記事");

    // A site chip turns the list into the feed's, under its hero. (The reload took the draft.)
    await draft();
    await page.getByRole("navigation", { name: "サイト" }).getByRole("link", { name: /^E2E 量産サイト/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&s=\\d+&a=1$`));
    await expect(feedTitle(page, "E2E 量産サイト")).toBeVisible();
    await kept();
    const site = new URL(page.url()).search;

    // ← goes back to the inbox with the list's filter.
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL(`/${site}`);
    await expect(heading(page)).toHaveCount(0);
  });

  test("取得時刻が同じ記事も、一覧・「もっと見る」・次の記事でいつも同じ順に並ぶ", async ({ page }) => {
    const titles = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `同時刻 ${from + i}`);
    const headings = () => list(page).getByRole("heading");

    await openFeed(page, "E2E 同時刻");
    const filtered = new URL(page.url()).search;
    await expect(headings()).toHaveText(titles(1, 30));
    await page.getByRole("link", { name: /もっと見る/ }).click();
    await expect(headings()).toHaveText(titles(1, 34));
    await page.reload();
    await expect(headings()).toHaveText(titles(1, 34));

    // Reading the 30th card opens the one 「もっと見る」 shows 31st.
    await page.goto(`/${filtered}`);
    await markPage(page);
    await expect(headings()).toHaveText(titles(1, 30));
    await card(page, "同時刻 30").getByRole("link").click();
    await expect(heading(page)).toHaveText("同時刻 30");
    await page.keyboard.press("e");
    await expect(heading(page)).toHaveText("同時刻 31");
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${filtered}$`));

    // After 「もっと見る」 beside the open article, j / s move within the longer list.
    await page.getByRole("link", { name: /もっと見る/ }).click();
    await expect(headings()).toHaveText([...titles(1, 29), ...titles(31, 34)]);
    await expect(heading(page)).toHaveText("同時刻 31");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("同時刻 32");
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("同時刻 33");
    await expect(headings()).toHaveText([...titles(1, 29), ...titles(31, 31), ...titles(33, 34)]);
    await expectNoReload(page);
  });

  test("記事を開いたまま一覧を切り替えると、e / s / j とボタンは新しい一覧の中で動く", async ({ page }) => {
    await openWithSeen(page, "E2E 切り替え前");
    await markPage(page);
    await card(page, "切り替え前 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("切り替え前 1");
    // An action before the switch: this used to make every later one reload the page.
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("切り替え前 2");
    const before = page.url();

    await folderNav(page).getByRole("link", { name: /^E2E 切り替え後\s*\d+$/ }).click();
    await expect(page).not.toHaveURL(before);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&a=1$/);
    const filtered = new URL(page.url()).search;
    await expect(heading(page)).toHaveText("切り替え前 2");
    await expect(card(page, "切り替え後 1")).toBeVisible();

    const main = page.getByRole("main");
    await main.getByRole("button", { name: "再開する" }).click();
    await expect(main.getByRole("button", { name: "このサイトの取得を止める" })).toBeVisible();
    await expect(heading(page)).toHaveText("切り替え前 2");

    // The open article is not in the new list, so reading it opens the new list's first card.
    await main.getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText("切り替え後 1");
    await expect(page).toHaveURL(new RegExp(`/articles/\\d+\\${filtered}$`));
    await expect(card(page, "切り替え後 1")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("切り替え後 2");
    await expect(card(page, "切り替え後 1")).toHaveCount(0);
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("切り替え後 3");
    await page.keyboard.press("e");
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(card(page, "切り替え後 3")).toHaveCount(0);
    await expectNoReload(page);

    await page.goto("/read");
    for (const t of ["切り替え前 2", "切り替え後 3"]) await expect(page.getByText(t)).toBeVisible();
    for (const t of ["切り替え前 1", "切り替え後 1", "切り替え後 2"]) await expect(page.getByText(t)).toHaveCount(0);
  });

  test("記事を開いてもサーバーは一覧を作らず、チップや「もっと見る」では一覧を 1 回だけ作る", async ({ page }) => {
    await openWithSeen(page, "E2E たくさん");
    let responses = await serverLists(page, async () => {
      await card(page, "量産記事 5").getByRole("link").click();
      await expect(heading(page)).toHaveText("量産記事 5");
    });
    expect(responses.length).toBeGreaterThan(0);
    expect(listsIn(responses)).toBe(0);

    responses = await serverLists(page, async () => {
      await card(page, "量産記事 6").getByRole("link").click();
      await expect(heading(page)).toHaveText("量産記事 6");
    });
    expect(listsIn(responses)).toBe(0);

    const sites = page.getByRole("navigation", { name: "サイト" });
    responses = await serverLists(page, async () => {
      await sites.getByRole("link", { name: /^E2E 量産サイト/ }).click();
      await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+&a=1$/);
      await expect(feedTitle(page, "E2E 量産サイト")).toBeVisible();
    });
    expect(listsIn(responses)).toBe(1);

    responses = await serverLists(page, async () => {
      await page.getByRole("link", { name: /もっと見る/ }).click();
      await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+&n=60&a=1$/);
      await expect(list(page).getByRole("listitem")).toHaveCount(35);
    });
    expect(listsIn(responses)).toBe(1);
    await expect(heading(page)).toHaveText("量産記事 6");

    // Loaded directly, the article comes without the list, which then fills the pane beside it.
    const url = page.url();
    const html = await fullLoad(page, url);
    expect(html).toContain("量産記事 6");
    expect(hasList(html)).toBe(false);
    responses = await serverLists(page, async () => {
      await page.goto(url);
      await expect(heading(page)).toHaveText("量産記事 6");
      await expect(list(page).getByRole("listitem")).toHaveCount(35);
    });
    expect(listsIn(responses)).toBe(1);
    await expect(page).toHaveURL(url);
    await expect(card(page, "量産記事 6")).toHaveAttribute("aria-current", "true");
  });
});

// The article sheet over the Board (`lg` and up). Its folders are the last ones in e2e/seed.mts.
const sheet = (page: Page) => page.getByRole("dialog", { name: "記事" });
const closeButton = (page: Page) => page.getByRole("button", { name: "記事を閉じる" });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const columnList = (page: Page, name: string) => column(page, name).getByRole("list");
const row = (page: Page, name: string, title: string) =>
  columnList(page, name).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const unreadIn = (page: Page, name: string) => column(page, name).getByLabel(/^未読 \d+ 本$/);
const place = (page: Page) => sheet(page).getByText(/^\d+ \/ \d+$/);
/** The row of folder groups on the Board, which scrolls sideways. */
const boardRow = (page: Page) => page.locator("[data-list-pane] section[aria-label]").first().locator("xpath=..");
const scrollLeft = (el: Locator) => el.evaluate((e) => e.scrollLeft);

test.describe("PC 幅のシート", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("ボードの見出しでシートが重なり、Esc / ✕ / スクリムでボードに同じ位置のまま戻る", async ({ page }) => {
    const site = "E2E シート A";
    await page.goto("/");
    // The folder is the last one: the Board scrolls sideways to it, and the column scrolls a little
    // (less than a row, which would count the row as seen).
    await column(page, site).scrollIntoViewIfNeeded();
    await columnList(page, site).evaluate((e) => (e.scrollTop = 30));
    const left = await scrollLeft(boardRow(page));
    expect(left).toBeGreaterThan(0);
    expect(await scrollTop(columnList(page, site))).toBe(30);
    await expect(unreadIn(page, site)).toHaveText("20");
    await markPage(page);

    // Rows below the first, which the scroll above has cut: a click would scroll that one into view.
    const titles = ["E2E シート A 2", "E2E シート A 3", "E2E シート A 4"];
    const closes = [
      () => page.keyboard.press("Escape"),
      () => closeButton(page).click(),
      // The scrim, to the left of the sheet.
      () => page.mouse.click(100, 450),
    ];
    for (const [i, close] of closes.entries()) {
      await row(page, site, titles[i]).getByRole("link").click();
      await expect(heading(page)).toHaveText(titles[i]);
      await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
      await expect(sheet(page)).toBeVisible();
      await expect(place(page)).toHaveText(`${i + 2} / 20`);
      // The Board stays behind at the whole width; no feed list takes its place.
      await expect(column(page, site)).toBeVisible();
      await expect(page.getByRole("list", { name: "記事", exact: true })).toHaveCount(0);
      expect((await page.locator("[data-list-pane]").boundingBox())!.width).toBe(1440);
      await expect.poll(async () => (await sheet(page).boundingBox())?.x).toBe(1440 - Math.floor(1440 * 0.72));
      const box = (await sheet(page).boundingBox())!;
      expect(box.x + box.width).toBe(1440);
      // The chat is a column of the sheet at this width.
      const chatBox = (await chat(page).boundingBox())!;
      expect([chatBox.x + chatBox.width, chatBox.width]).toEqual([1440, 380]);
      // The feed's favicon and name head the sheet; there is no ←.
      await expect(sheet(page).getByRole("banner").getByText(site, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "戻る", exact: true })).toBeHidden();

      await close();
      await expect(page).toHaveURL("/");
      await expect(heading(page)).toHaveCount(0);
      await expect(sheet(page)).toHaveCount(0);
      expect(await scrollLeft(boardRow(page))).toBe(left);
      expect(await scrollTop(columnList(page, site))).toBe(30);
      await expect(row(page, site, titles[i])).toHaveAttribute("data-seen", "");
      await expect(unreadIn(page, site)).toHaveText(String(19 - i));
    }
    await expectNoReload(page);

    // Browser back opens the sheet over the Board again; forward closes it.
    await page.goBack();
    await expect(heading(page)).toHaveText(titles[2]);
    await expect(column(page, site)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);
    await expect(column(page, site)).toBeVisible();
  });

  test("フォルダのタブから開くと、閉じてそのタブに戻る", async ({ page }) => {
    const site = "E2E シート B";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シート\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    const tab = page.url();
    await row(page, site, "E2E シート B 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E シート B 1");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(tab);
    await expect(column(page, site)).toBeVisible();
  });

  test("j / k でその列の中を進み、列の末尾を越えても別のフィードに移らない。「n / N」が変わる", async ({ page }) => {
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートで j\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);

    const three = "E2E シート 三本";
    await row(page, three, `${three} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${three} 1`);
    await expect(place(page)).toHaveText("1 / 3");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${three} 2`);
    await expect(place(page)).toHaveText("2 / 3");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${three} 3`);
    await expect(place(page)).toHaveText("3 / 3");
    // The last of the feed: j goes nowhere, not to the next column.
    await page.keyboard.press("j");
    await page.waitForTimeout(500);
    await expect(heading(page)).toHaveText(`${three} 3`);
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText(`${three} 2`);
    await expect(place(page)).toHaveText("2 / 3");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/\?f=\d+$/);

    // Past the 50 rows of a column, j goes on in the same feed, and k comes back.
    const many = "E2E シート 五十二本";
    const last = columnList(page, many).getByRole("listitem").nth(49);
    await expect(last).toContainText(`${many} 50`);
    await last.getByRole("link").click();
    await expect(heading(page)).toHaveText(`${many} 50`);
    await expect(place(page)).toHaveText("50 / 50");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${many} 51`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    await expect(place(page)).toHaveText("51 / 51");
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${many} 52`);
    await page.keyboard.press("j");
    await page.waitForTimeout(500);
    await expect(heading(page)).toHaveText(`${many} 52`);
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText(`${many} 51`);
    await page.keyboard.press("k");
    await expect(heading(page)).toHaveText(`${many} 50`);
    await expect(column(page, many)).toBeVisible();
  });

  test("列を読み込んだあとに未読になった、列のどの行よりも新しい記事は、列の末尾の j で開かない", async ({ page }) => {
    const site = "E2E シート 新着";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートで j\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(unreadIn(page, site)).toHaveText("2");
    await expect(row(page, site, `${site} 1`)).toHaveCount(0);

    // Another tab makes the feed's newest article unread again, as an hourly fetch would bring one.
    const other = await page.context().newPage();
    await other.goto("/read");
    await other.getByRole("link", { name: new RegExp(`${site} 1`) }).click();
    await expect(other.getByRole("heading", { level: 1 })).toHaveText(`${site} 1`);
    await other.getByRole("button", { name: "未読に戻す" }).click();
    await expect(other).not.toHaveURL(/\/articles\//);
    await other.close();

    await row(page, site, `${site} 3`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${site} 3`);
    await expect(place(page)).toHaveText("2 / 2");
    const url = page.url();
    let sent = 0;
    await page.route("**/*", (route) => {
      if ("next-action" in route.request().headers()) sent++;
      return route.fallback();
    });
    await page.keyboard.press("j");
    await expect.poll(() => sent).toBeGreaterThan(0);
    // Long enough for the article it found, had there been one, to have opened.
    await page.waitForTimeout(500);
    await expect(heading(page)).toHaveText(`${site} 3`);
    await expect(page).toHaveURL(url);
    await expect(place(page)).toHaveText("2 / 2");
  });

  test("読了 / スキップで同じフィードの次が開き、最後の 1 本でシートが閉じてボードに戻る。保存に失敗すればもう一度押せる", async ({ page }) => {
    const site = "E2E シート 読了";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートで読了\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    const tab = page.url();
    await row(page, site, `${site} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${site} 1`);

    await page.route("**/*", (route) => ("next-action" in route.request().headers() ? route.abort() : route.fallback()));
    await sheet(page).getByRole("button", { name: "読了にする" }).click();
    await expect(sheet(page).getByRole("alert")).toHaveText("保存できませんでした。もう一度押してください");
    await expect(heading(page)).toHaveText(`${site} 1`);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    await page.unrouteAll();

    await sheet(page).getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText(`${site} 2`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    await expect(column(page, site)).toBeVisible();

    await sheet(page).getByRole("button", { name: "スキップ" }).click();
    await expect(page).toHaveURL(tab);
    await expect(sheet(page)).toHaveCount(0);
    await expect(unreadIn(page, site)).toHaveText("0");
    // The toast stays above everything, so the skip can be undone.
    await expect(page.getByRole("button", { name: "元に戻す" })).toBeVisible();

    await page.goto("/read");
    await expect(page.getByText(`${site} 1`)).toBeVisible();
    await expect(page.getByText(`${site} 2`)).toHaveCount(0);
  });

  test("記事の URL を直接開くとシートの後ろに一覧が届き、Esc でフィードの一覧に戻る。リロードでも同じ", async ({ page }) => {
    const site = "E2E シート 直接";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートを直接\s*\d+$/ }).click();
    const href = (await row(page, site, `${site} 1`).getByRole("link").getAttribute("href"))!;

    await page.goto(href);
    await expect(heading(page)).toHaveText(`${site} 1`);
    await expect(sheet(page)).toBeVisible();
    await expect(card(page, `${site} 1`)).toHaveAttribute("aria-current", "true");
    await expect(list(page).getByRole("listitem")).toHaveCount(2);
    await expect(page).toHaveURL(href);
    await expect(place(page)).toHaveText("1 / 2");
    await page.reload();
    await expect(heading(page)).toHaveText(`${site} 1`);
    await expect(list(page).getByRole("listitem")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(`/${new URL(href, page.url()).search}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(feedTitle(page, site)).toBeVisible();
    // The feed list takes the whole width, with nothing beside it.
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeHidden();
  });

  test("シートを開くとキーは記事に向き、後ろの列はスクロールも既読にもならず、Tab も届かない。閉じると行に戻る", async ({ page }) => {
    const site = "E2E シート キー";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートでキー\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(unreadIn(page, site)).toHaveText("20");
    const link = row(page, site, `${site} 1`).getByRole("link");
    await link.click();
    await expect(heading(page)).toHaveText(`${site} 1`);
    const inSheet = () => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
    await expect.poll(inSheet).toBe(true);

    // PageDown scrolls the article; the column behind stays, and no row of it counts as scrolled past.
    const pane = sheet(page).locator("main").locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
    for (let i = 0; i < 3; i++) await page.keyboard.press("PageDown");
    await expect.poll(() => scrollTop(pane)).toBeGreaterThan(0);
    // Longer than SeenOnScroll takes to count and save a row.
    await page.waitForTimeout(2500);
    expect(await scrollTop(columnList(page, site))).toBe(0);
    await expect(unreadIn(page, site)).toHaveText("20");
    await expect(page.getByText(/ここまで既読/)).toHaveCount(0);

    // Tab stays out of the Board and the header behind the sheet.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-list-pane], [data-app-header]"))).toBe(false);
    }

    await page.keyboard.press("Escape");
    await expect(heading(page)).toHaveCount(0);
    await expect(link).toBeFocused();
    await expect(unreadIn(page, site)).toHaveText("19");
    expect(await scrollTop(columnList(page, site))).toBe(0);
  });

  test("チャットの入力中は Esc / j / k / e / s が効かない", async ({ page }) => {
    const site = "E2E シート 入力";
    await page.goto("/");
    await folderNav(page).getByRole("link", { name: /^E2E シートで入力\s*\d+$/ }).click();
    await row(page, site, `${site} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${site} 1`);
    const url = page.url();
    const input = chat(page).getByPlaceholder("質問や感想を書く");
    await input.click();
    await page.keyboard.type("jkes");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await expect(input).toHaveValue("jkes");
    await expect(page).toHaveURL(url);
    await expect(sheet(page)).toBeVisible();
    await expect(heading(page)).toHaveText(`${site} 1`);
  });
});

test.describe("狭い PC 幅", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("対話は右からの引き出しになり、本文が読める幅になる", async ({ page }) => {
    await openFeed(page, "E2E たくさん");
    await card(page, "量産記事 9").getByRole("link").click();
    await expect(heading(page)).toHaveText("量産記事 9");
    await expect(list(page)).toBeVisible();
    await expect(chat(page)).toBeHidden();
    const main = (await page.getByRole("main").boundingBox())!;
    expect(main.width).toBeGreaterThanOrEqual(600);

    await page.getByRole("button", { name: "AI と話す" }).click();
    await expect(chat(page)).toBeVisible();
    const drawer = (await chat(page).boundingBox())!;
    expect(drawer.x + drawer.width).toBeCloseTo(1100, 0);
    await chat(page).getByRole("button", { name: "閉じる" }).click();
    await expect(chat(page)).toBeHidden();
  });
});

/** Whether the page scrolls sideways. */
const overflowsX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

// An unfolded iPhone Duo (the estimated portrait width, and portrait and landscape as measured in
// the simulator) reads with the list and the article side by side, like a PC; the chat is a
// drawer from the right.
for (const viewport of [
  { width: 626, height: 890 }, // unfolded portrait, estimated
  { width: 669, height: 825 },
  { width: 951, height: 543 },
]) {
  test.describe(`展開したスマホ幅 ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("一覧と記事が横に並び、横にはみ出さない。対話は右からの引き出しで、入力欄が見える", async ({ page }) => {
      await openWithSeen(page, "E2E たくさん");
      await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeVisible();
      expect(await overflowsX(page)).toBe(false);

      await card(page, "量産記事 9").getByRole("link").click();
      await expect(heading(page)).toHaveText("量産記事 9");
      await expect(list(page)).toBeVisible();
      await expect(page.getByRole("link", { name: "Reading Room" })).toBeVisible();
      const listBox = (await pane(page).boundingBox())!;
      const mainBox = (await page.getByRole("main").boundingBox())!;
      expect(listBox.x).toBe(0);
      expect(mainBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width);
      expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(viewport.width);
      expect(Math.abs(mainBox.y - listBox.y)).toBeLessThan(100);
      expect(await overflowsX(page)).toBe(false);
      // The cards fit the narrower list pane instead of scrolling it sideways.
      expect(await pane(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);

      // The phone's bottom bar gives way to the actions under the article.
      await expect(page.getByRole("button", { name: "AI に質問する" })).toBeHidden();
      await expect(chat(page)).toBeHidden();
      await page.getByRole("button", { name: "AI と話す" }).click();
      await expect(chat(page)).toBeVisible();
      const drawer = (await chat(page).boundingBox())!;
      expect(drawer.x + drawer.width).toBeCloseTo(viewport.width, 0);
      expect(drawer.y).toBe(0);
      const input = chat(page).getByPlaceholder("質問や感想を書く");
      await expect(input).toBeInViewport({ ratio: 1 });
      await input.fill("引き出しから質問");
      await expect(chat(page).getByRole("button", { name: "送信" })).toBeInViewport({ ratio: 1 });
      await chat(page).getByRole("button", { name: "閉じる" }).click();
      await expect(chat(page)).toBeHidden();

      // Another card opens beside the list without leaving it.
      await card(page, "量産記事 10").getByRole("link").click();
      await expect(heading(page)).toHaveText("量産記事 10");
      await expect(card(page, "量産記事 10")).toHaveAttribute("aria-current", "true");
    });
  });
}

// A folded iPhone Duo stays a phone: the list and the article are separate screens.
for (const width of [382, 466]) {
  test.describe(`閉じたスマホ幅 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("一覧と記事が別の画面になる", async ({ page }) => {
      await openWithSeen(page, "E2E たくさん");
      await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeHidden();
      expect(await overflowsX(page)).toBe(false);

      await card(page, "量産記事 9").getByRole("link").click();
      await expect(heading(page)).toHaveText("量産記事 9");
      await expect(list(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Reading Room" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "AI に質問する" })).toBeVisible();
      expect(await overflowsX(page)).toBe(false);

      await page.getByRole("link", { name: "戻る", exact: true }).click();
      await expect(heading(page)).toHaveCount(0);
      await expect(card(page, "量産記事 9")).toBeVisible();
    });
  });
}

test("スマホ幅の記事画面には一覧もヘッダーも出ず、キー操作も効かない @mobile", async ({ page }) => {
  await page.goto("/?a=1");
  await card(page, "対話のある記事").getByRole("link").click();
  await expect(heading(page)).toHaveText("対話のある記事");
  const url = page.url();
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reading Room" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "戻る", exact: true })).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await page.waitForTimeout(500); // gives a wrongly handled key time to navigate
  await expect(page).toHaveURL(url);
  await expect(heading(page)).toHaveText("対話のある記事");
});

test("スマホ幅で記事の URL を直接開くと、一覧を作らずに記事だけを返す @mobile", async ({ page }) => {
  await page.goto("/?a=1");
  const href = (await card(page, "ビジネスの記事").getByRole("link").getAttribute("href"))!;
  const html = await fullLoad(page, href);
  expect(html).toContain("ビジネスの記事");
  expect(hasList(html)).toBe(false);
  const responses = await serverLists(page, async () => {
    await page.goto(href);
    await expect(heading(page)).toHaveText("ビジネスの記事");
    await page.waitForTimeout(500); // gives a wrongly started list load time to show up
  });
  expect(responses).toEqual([]);
  await expect(page).toHaveURL(href);

  // The list is built when going back to it.
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(page).toHaveURL("/?a=1");
  await expect(card(page, "ビジネスの記事")).toBeVisible();
});
