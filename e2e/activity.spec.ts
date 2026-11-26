import { expect, test, type Page, type Request } from "./test";
import { openFeed, openTab } from "./nav";

// The activity log: track() (src/lib/track.ts) sends events to /api/activity. The server's
// database cannot be read from here, so tests look at what the page sends and at what the API
// answers. Folders are the 「E2E 記録 …」 ones at the end of e2e/seed.mts, one per test that
// reads or skips, each with 3 unread articles and a read one (4).

type Sent = Record<string, unknown>;

const isActivity = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/activity";
const parse = (r: Request): Sent => JSON.parse(r.postData() ?? "null");
/** Collects every event the page sends from now on. */
function recordActivity(page: Page) {
  const sent: Sent[] = [];
  page.on("request", (r) => {
    if (isActivity(r)) sent.push(parse(r));
  });
  return sent;
}
const opens = (sent: Sent[]) => sent.filter((e) => e.type === "open");
/** The next `open` the page sends. */
const nextOpen = (page: Page) =>
  page.waitForRequest((r) => isActivity(r) && parse(r).type === "open").then(parse);
// The widest screen with the list beside an open article.
const BESIDE = { width: 1000, height: 800 };
/** The article id in the page's URL. */
const openId = (page: Page) => Number(/\/articles\/(\d+)/.exec(page.url())![1]);

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const list = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const article = (page: Page) => page.getByRole("main");
const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
/** Waits a little and checks that no other `open` was sent meanwhile. */
async function expectOpens(sent: Sent[], n: number) {
  await new Promise((r) => setTimeout(r, 500));
  expect(opens(sent)).toHaveLength(n);
}

test.describe("PC 幅", () => {
  test("ボードの行から開くと source=board・device=pc・layout=split の open が 1 回送られ、一覧の切り替えや refresh では増えない", async ({ page }) => {
    const folder = "E2E 記録 ボード";
    // The list beside an open article: from `lg` up the article is a sheet over it (panes.spec.ts).
    await page.setViewportSize(BESIDE);
    await openTab(page, folder);
    const sent = recordActivity(page);
    const open = nextOpen(page);
    const stored = page.waitForResponse((r) => isActivity(r.request()));
    await column(page, `${folder}のサイト`).getByRole("link", { name: new RegExp(`${folder} 1`) }).click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    const id = openId(page);
    expect(await open).toMatchObject({
      type: "open",
      source: "board",
      device: "pc",
      layout: "split",
      screen: "article",
      articleId: id,
      standalone: false,
      vw: 1000,
      vh: 800,
    });
    // What the page sends is what the server takes.
    expect((await stored).status()).toBe(204);
    const first = opens(sent)[0];
    expect(first.viewId).toMatch(/^[\w-]+$/);
    expect(first.sessionId).toMatch(/^[\w-]+$/);
    await expectOpens(sent, 1);

    // The feed list beside the article arrives through `/articles/<id>/list` and back; 既読を含む
    // changes only the list (and the URL).
    await expect(card(page, `${folder} 2`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/articles/${id}\\?f=\\d+&s=\\d+$`));
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(page).toHaveURL(new RegExp(`/articles/${id}\\?f=\\d+&s=\\d+&a=1$`));
    // Stopping and resuming the site refreshes the router.
    await page.getByRole("button", { name: "このサイトの取得を止める" }).click();
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(page.getByText("このサイトは取得を止めています")).toBeVisible();
    await page.getByRole("button", { name: "再開する" }).click();
    await expect(page.getByRole("button", { name: "このサイトの取得を止める" })).toBeVisible();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    await expectOpens(sent, 1);

    // Another article from the list beside it is a new view, from the list.
    const second = nextOpen(page);
    await card(page, `${folder} 2`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    const next = await second;
    expect(next).toMatchObject({ source: "list", articleId: openId(page) });
    expect(next.viewId).not.toBe(first.viewId);
    expect(next.sessionId).toBe(first.sessionId);
  });

  test("「今朝の 5 本」の行から開くと source=picks、同じ記事を列の行から開くと source=board。別タブで開いた後も board のまま", async ({
    page,
  }) => {
    // The fifth pick is this test's (e2e/picks.spec.ts).
    const title = "今朝の 5 本目";
    const picks = page.getByRole("region", { name: "今朝の 5 本", exact: true });
    const columnRow = column(page, "E2E 今朝のサイト").getByRole("listitem").filter({ hasText: title });
    await page.goto("/");
    const sent = recordActivity(page);
    let open = nextOpen(page);
    await picks.getByRole("link", { name: new RegExp(title) }).click();
    await expect(heading(page)).toHaveText(title);
    const id = openId(page);
    expect(await open).toMatchObject({ type: "open", source: "picks", articleId: id, screen: "article" });
    await expectOpens(sent, 1);

    // Back on the Board, the same article from its column.
    await page.goBack();
    await expect(heading(page)).toHaveCount(0);
    open = nextOpen(page);
    await columnRow.getByRole("link").click();
    await expect(heading(page)).toHaveText(title);
    expect(await open).toMatchObject({ source: "board", articleId: id });
    await expectOpens(sent, 2);

    // A pick opened in another tab marks nothing here: the next one from a column is still `board`.
    await page.goBack();
    await expect(heading(page)).toHaveCount(0);
    const tab = page.context().waitForEvent("page");
    await picks.getByRole("link", { name: new RegExp(title) }).click({ modifiers: ["ControlOrMeta"] });
    await (await tab).close();
    await expect(heading(page)).toHaveCount(0);
    open = nextOpen(page);
    await columnRow.getByRole("link").click();
    await expect(heading(page)).toHaveText(title);
    expect(await open).toMatchObject({ source: "board", articleId: id });
    await expectOpens(sent, 3);
  });

  test("記事の横でフォルダのチップや「もっと見る」を押しても open は増えない", async ({ page }) => {
    // The list beside an open article: from `lg` up the article is a sheet over it (panes.spec.ts).
    await page.setViewportSize(BESIDE);
    await page.goto("/?a=1");
    const sent = recordActivity(page);
    await card(page, "対話のある記事").getByRole("link").click();
    await expect(heading(page)).toHaveText("対話のある記事");
    await expect.poll(() => opens(sent)).toHaveLength(1);
    expect(opens(sent)[0]).toMatchObject({ source: "list", articleId: openId(page) });
    const id = openId(page);

    await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/articles/${id}\\?f=\\d+&a=1$`));
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await page.getByRole("link", { name: /もっと見る/ }).click();
    await expect(page).toHaveURL(new RegExp(`/articles/${id}\\?f=\\d+&n=60&a=1$`));
    await expect(list(page).getByRole("listitem")).toHaveCount(35);
    await expect(heading(page)).toHaveText("対話のある記事");
    await expectOpens(sent, 1);
  });

  test("URL を直接開く・再読み込みは source=direct、読了一覧からは source=read", async ({ page }) => {
    const folder = "E2E 記録 ボード";
    await page.goto("/read");
    let open = nextOpen(page);
    await page.getByRole("link", { name: new RegExp(`${folder} 4`) }).click();
    await expect(heading(page)).toHaveText(`${folder} 4`);
    expect(await open).toMatchObject({ source: "read", articleId: openId(page) });

    const id = openId(page);
    open = nextOpen(page);
    await page.goto(`/articles/${id}`);
    expect(await open).toMatchObject({ source: "direct", articleId: id });
    open = nextOpen(page);
    await page.reload();
    expect(await open).toMatchObject({ source: "direct", articleId: id });
  });

  test("読了した後に開く次の記事は source=next、j で移ると source=key", async ({ page }) => {
    const folder = "E2E 記録 次へ";
    await openFeed(page, folder);
    let open = nextOpen(page);
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    expect(await open).toMatchObject({ source: "list" });

    open = nextOpen(page);
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${folder} 2`);
    expect(await open).toMatchObject({ source: "key", articleId: openId(page) });

    open = nextOpen(page);
    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(heading(page)).toHaveText(`${folder} 3`);
    expect(await open).toMatchObject({ source: "next", articleId: openId(page) });

    // Browser back to the previous article: chosen from the screen before, not marked.
    const sent = recordActivity(page);
    await page.goBack();
    await expect(heading(page)).toHaveText(`${folder} 2`);
    await expect.poll(() => opens(sent)).toHaveLength(1);
    expect(opens(sent)[0]).toMatchObject({ source: "list" });
  });

  for (const [folder, block] of [
    ["E2E 記録 遮断", "abort"],
    ["E2E 記録 500", "500"],
  ] as const) {
    test(`記録に失敗しても (${block}) 記事が開き、読了・スキップでき、エラーもトーストも出ない`, async ({ page }) => {
      let blocked = 0;
      await page.route("**/api/activity", (route) => {
        blocked++;
        return block === "abort" ? route.abort() : route.fulfill({ status: 500, body: "" });
      });
      await openFeed(page, folder);
      await card(page, `${folder} 1`).getByRole("link").click();
      await expect(heading(page)).toHaveText(`${folder} 1`);
      await expect.poll(() => blocked).toBeGreaterThan(0);

      await article(page).getByRole("button", { name: "読了にする" }).click();
      await expect(heading(page)).toHaveText(`${folder} 2`);
      await expect(page.getByRole("status")).toHaveText(/読了にしました/);
      await article(page).getByRole("button", { name: "スキップ", exact: true }).click();
      await expect(heading(page)).toHaveText(`${folder} 3`);
      await expect(card(page, `${folder} 1`)).toHaveCount(0);
      await expect(card(page, `${folder} 2`)).toHaveCount(0);
      expect(blocked).toBeGreaterThanOrEqual(3);

      await expect(page.getByText("保存できませんでした")).toHaveCount(0);
      await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    });
  }
});

test.describe("横向きの iPhone 相当 (852×393・タッチ)", () => {
  test.use({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true });

  test("device=phone・layout=split になる", async ({ page }) => {
    const folder = "E2E 記録 横向き";
    await openFeed(page, folder);
    const open = nextOpen(page);
    await card(page, `${folder} 1`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${folder} 1`);
    expect(await open).toMatchObject({ device: "phone", layout: "split", vw: 852, vh: 393, source: "list" });
  });
});

test("スマホでフィード一覧から開くと source=list・device=phone・layout=single が送られる @mobile", async ({ page }) => {
  const folder = "E2E 記録 スマホ";
  await openFeed(page, folder);
  const sent = recordActivity(page);
  const open = nextOpen(page);
  await card(page, `${folder} 1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${folder} 1`);
  expect(await open).toMatchObject({ source: "list", device: "phone", layout: "single", articleId: openId(page) });

  // Back to the list and forward into the same article again: a new view.
  await page.goBack();
  await expect(heading(page)).toHaveCount(0);
  await page.goForward();
  await expect(heading(page)).toHaveText(`${folder} 1`);
  await expect.poll(() => opens(sent)).toHaveLength(2);
  expect(opens(sent)[1].viewId).not.toBe(opens(sent)[0].viewId);
});

test.describe("/api/activity", () => {
  const valid = {
    type: "open",
    sessionId: "e2e-session",
    device: "pc",
    layout: "split",
    vw: 1280,
    vh: 720,
    standalone: false,
    screen: "article",
    articleId: 1,
    source: "board",
    viewId: "e2e-view",
  };
  const post = (page: Page, data: unknown) =>
    page.request.post("/api/activity", { data: typeof data === "string" ? data : JSON.stringify(data) });

  test("正しい本文には 204、未知の type・型違い・長すぎる本文・JSON でないものには 400", async ({ page }) => {
    expect((await post(page, valid)).status()).toBe(204);
    // Optional fields may be left out, and an article that is gone is not an error.
    expect((await post(page, { ...valid, articleId: undefined, source: null, viewId: undefined })).status()).toBe(204);
    expect((await post(page, { ...valid, articleId: 999_999 })).status()).toBe(204);
    expect((await post(page, { ...valid, source: "picks" })).status()).toBe(204);
    expect((await post(page, { ...valid, scrollPct: 100, dwellMs: 0, props: { via: "key" } })).status()).toBe(204);

    for (const bad of [
      { ...valid, type: "unknown" },
      { ...valid, vw: "1280" },
      { ...valid, standalone: "false" },
      { ...valid, device: "tablet" },
      { ...valid, source: "elsewhere" },
      { ...valid, articleId: 1.5 },
      { ...valid, scrollPct: 101 },
      { ...valid, props: [1] },
      { ...valid, sessionId: undefined },
      { ...valid, props: { pad: "x".repeat(5000) } },
      [valid],
      "not json",
    ]) {
      expect((await post(page, bad)).status(), JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
  });
});
