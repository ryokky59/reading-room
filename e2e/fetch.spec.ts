import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

// 「今すぐ取得」 and 「URL を追加」 with pages that linkedom / Readability cannot parse. The pages
// come from a local server started here, so nothing reaches the outside network. Every other
// feed in the seed points at the local stub (e2e/stub.mts).

const cards = (page: Page) => page.getByRole("list", { name: "記事" }).getByRole("listitem");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });
const fetchButton = (page: Page) => page.getByRole("button", { name: "今すぐ取得" });
/**
 * Presses 「今すぐ取得」 once the page is hydrated. `goto` returns at `load`, and in CI the Board
 * at `/` takes about a second more to hydrate. A press in between is replayed afterwards, and
 * the fetch then really runs instead of meeting the routes the test set (CI traces: the press
 * at 1.0s, the first prefetch at 1.9s, and 「N 本の新着を追加しました」 on screen at the end).
 * The sign is the folder tabs' pill, which an effect of ChipRow shows: React has committed by then.
 */
async function pressFetch(page: Page) {
  await expect(page.locator(".chip-pill:not([hidden])").first()).toBeAttached({ timeout: 30_000 });
  await fetchButton(page).click();
}
const fetchFailure = (page: Page) => page.getByRole("alert").filter({ hasText: "取得できませんでした" });
const fetchCut = (page: Page) => page.getByRole("alert").filter({ hasText: "通信が切れました" });
const cutMessage = "通信が切れました。取得が終わっていれば一覧に出ています。出ていなければもう一度押してください";
const abortActions =(page: Page) =>
  page.route("**/*", (route) => ("next-action" in route.request().headers() ? route.abort() : route.fallback()));

const good = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${"<p>取得テストの本文です。段落をいくつか並べています。</p>".repeat(8)}</article></body></html>`;
// An empty body leaves linkedom without a root element; its head getter then throws
// "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null".
const empty = "";
// Without <html>/<body>, Readability climbs past the root while scoring and throws
// "Cannot read properties of null (reading 'tagName')" in _grabArticle.
const paragraph = `<p>${"これは本文の段落です。, ".repeat(30)}</p>`;
const fragment = `<div><section><article>${paragraph.repeat(5)}</article></section></div>`;

// Postgres rejects NUL in text; linkedom and Readability keep it in the body's text and HTML.
const withNul = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${"<p>NUL\u0000 を含む本文です。段落をいくつか並べています。</p>".repeat(8)}</article></body></html>`;

const pages: Record<string, string> = {
  "/posts/good": good("取得テスト 正常な記事"),
  "/nul/good": good("NUL テスト 正常な記事"),
  "/nul/body": withNul("NUL テスト 本文に NUL がある記事"),
  "/nul/title": good("NUL テスト タイトルに NUL がある項目"),
  "/cut/good": good("通信切れテスト 保存された記事"),
  "/pages/nul": withNul("URL 追加 本文に NUL がある記事"),
  "/posts/empty": empty,
  "/posts/fragment": fragment,
  "/pages/empty": empty,
  "/pages/fragment": fragment,
};

test.describe("本文を取り出せないページ", () => {
  let server: Server;
  let origin: string;
  // The feeds are empty while they are added, so their articles come in through 「今すぐ取得」.
  let listItems = false;
  let listNulItems = false;
  let listCutItems = false;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/rss.xml") {
        const now = new Date().toUTCString();
        const items = [
          ["取得テスト 正常な記事", "/posts/good"],
          ["取得テスト 中身が空のページ", "/posts/empty"],
          ["取得テスト html と body がないページ", "/posts/fragment"],
        ];
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>取得テスト</title><link>${origin}/</link>
${listItems ? items.map(([t, p]) => `<item><title>${t}</title><link>${origin}${p}</link><pubDate>${now}</pubDate></item>`).join("") : ""}
</channel></rss>`);
      } else if (req.url === "/nul-broken.xml") {
        // The parser quotes the bad character in its error, so the feed's error holds a NUL.
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NUL 壊れた XML</title><link>${origin}/</link>
${listNulItems ? `<item><ti\u0000tle>壊れた項目</title><link>${origin}/nul/good</link></item>` : ""}
</channel></rss>`);
      } else if (req.url === "/nul.xml") {
        const now = new Date().toUTCString();
        const items = [
          ["NUL テスト 正常な記事", "/nul/good"],
          ["NUL テスト 本文に NUL がある記事", "/nul/body"],
          ["NUL テスト タイトルに\u0000 NUL がある項目", "/nul/title"],
        ];
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NUL テスト</title><link>${origin}/</link>
${listNulItems ? items.map(([t, p]) => `<item><title>${t}</title><link>${origin}${p}</link><description>${t} の概要</description><pubDate>${now}</pubDate></item>`).join("") : ""}
</channel></rss>`);
      } else if (req.url === "/cut.xml") {
        const now = new Date().toUTCString();
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>通信切れテスト</title><link>${origin}/</link>
${listCutItems ? `<item><title>通信切れテスト 保存された記事</title><link>${origin}/cut/good</link><pubDate>${now}</pubDate></item>` : ""}
</channel></rss>`);
      } else if (req.url && req.url in pages) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(pages[req.url]);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test("壊れたページが混ざっていても「今すぐ取得」が終わり、ほかの記事も保存される", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/feeds");
    await page.getByLabel("サイトを追加").fill(`${origin}/rss.xml`);
    await page.getByPlaceholder("表示名(空ならサイト名を使います)").fill("取得テスト");
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByText("「取得テスト」を追加し、0 本を取り込みました")).toBeVisible({ timeout: 60_000 });

    listItems = true;
    await page.goto("/");
    await fetchButton(page).click();
    // A feed that fails (the Board's seeded error feed) is listed after the count.
    await expect(page.getByText(/^3 本の新着を追加しました/)).toBeVisible({ timeout: 90_000 });
    await expect(fetchFailure(page)).toHaveCount(0);

    await expect(card(page, "取得テスト 正常な記事")).toBeVisible();
    await expect(card(page, "取得テスト 中身が空のページ")).toBeVisible();
    await expect(card(page, "取得テスト html と body がないページ")).toBeVisible();

    // The broken pages are saved without their body.
    await card(page, "取得テスト html と body がないページ").getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("取得テスト html と body がないページ");
    await expect(page.getByRole("main")).toContainText("本文を取得できませんでした");

    await page.goto("/");
    await card(page, "取得テスト 正常な記事").getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("取得テスト 正常な記事");
    await expect(page.getByRole("main")).toContainText("取得テストの本文です。");
  });

  test("NUL 文字を含む記事やフィードが混ざっていても「今すぐ取得」が終わり、どの記事も NUL 抜きで保存される", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/feeds");
    for (const [path, name] of [
      ["/nul.xml", "NUL テスト"],
      ["/nul-broken.xml", "NUL 壊れた XML"],
    ]) {
      await page.getByLabel("サイトを追加").fill(`${origin}${path}`);
      await page.getByPlaceholder("表示名(空ならサイト名を使います)").fill(name);
      await page.getByRole("button", { name: "追加する" }).click();
      await expect(page.getByText(`「${name}」を追加し、0 本を取り込みました`)).toBeVisible({ timeout: 60_000 });
    }

    listNulItems = true;
    await page.goto("/");
    await fetchButton(page).click();
    const result = page.getByText(/^3 本の新着を追加しました/);
    await expect(result).toBeVisible({ timeout: 90_000 });
    await expect(result).toContainText("NUL 壊れた XML");
    await expect(fetchFailure(page)).toHaveCount(0);

    await expect(card(page, "NUL テスト 正常な記事")).toBeVisible();
    await expect(card(page, "NUL テスト タイトルに NUL がある項目")).toBeVisible();

    await card(page, "NUL テスト 本文に NUL がある記事").getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NUL テスト 本文に NUL がある記事");
    await expect(page.getByRole("main")).toContainText("NUL を含む本文です。");

    // The broken feed is recorded as failed, with the parser's message minus the NUL.
    await page.goto("/feeds");
    await expect(page.getByRole("main").getByText(/^取得失敗: Invalid character in tag name/)).toBeVisible();
  });

  test("「今すぐ取得」の応答の前に通信が切れても、通信が切れたと出て、サーバーで保存された記事が一覧に出る", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/feeds");
    await page.getByLabel("サイトを追加").fill(`${origin}/cut.xml`);
    await page.getByPlaceholder("表示名(空ならサイト名を使います)").fill("通信切れテスト");
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByText("「通信切れテスト」を追加し、0 本を取り込みました")).toBeVisible({ timeout: 60_000 });

    listCutItems = true;
    await page.goto("/");
    await expect(card(page, "通信切れテスト 保存された記事")).toHaveCount(0);
    // The request reaches the server, which fetches and saves everything; only the response is lost.
    let reachedServer = false;
    await page.route("**/*", async (route) => {
      if (!("next-action" in route.request().headers())) return route.fallback();
      await route.fetch({ timeout: 90_000 });
      reachedServer = true;
      await route.abort();
    });
    await pressFetch(page);
    await expect(fetchCut(page)).toHaveText(cutMessage, { timeout: 90_000 });
    expect(reachedServer).toBe(true);
    await expect(fetchFailure(page)).toHaveCount(0);
    await expect(card(page, "通信切れテスト 保存された記事")).toBeVisible();
    await expect(fetchButton(page)).toBeEnabled();

    // Pressing again is harmless: the article is not added twice.
    await page.unrouteAll();
    await fetchButton(page).click();
    await expect(page.getByText(/^0 本の新着を追加しました/)).toBeVisible({ timeout: 90_000 });
    await expect(fetchCut(page)).toHaveCount(0);
    await expect(card(page, "通信切れテスト 保存された記事")).toHaveCount(1);
  });

  test("「URL を追加」で NUL 文字を含むページを追加すると、記事が開く", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "URL を追加" }).click();
    await page.getByPlaceholder("https://…").fill(`${origin}/pages/nul`);
    await page.getByRole("button", { name: "追加して読む" }).click();
    await expect(page).toHaveURL(/\/articles\/\d+/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("URL 追加 本文に NUL がある記事");
    await expect(page.getByRole("main")).toContainText("NUL を含む本文です。");
  });

  for (const path of ["/pages/empty", "/pages/fragment"]) {
    test(`「URL を追加」で壊れたページ(${path})を追加すると、本文なしの記事が開く`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/");
      await page.getByRole("button", { name: "URL を追加" }).click();
      await page.getByPlaceholder("https://…").fill(`${origin}${path}`);
      await page.getByRole("button", { name: "追加して読む" }).click();
      await expect(page).toHaveURL(/\/articles\/\d+/, { timeout: 45_000 });
      await expect(page.getByRole("main")).toContainText("本文を取得できませんでした");
    });
  }
});

test("「今すぐ取得」の通信が切れると、ボタンの下に通信が切れたと出て、もう一度押せる", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await abortActions(page);
  await pressFetch(page);
  await expect(fetchCut(page)).toHaveText(cutMessage);
  await expect(fetchFailure(page)).toHaveCount(0);
  await expect(fetchButton(page)).toBeEnabled();

  await page.unrouteAll();
  await fetchButton(page).click();
  await expect(page.getByText(/本の新着を追加しました/)).toBeVisible({ timeout: 60_000 });
  await expect(fetchCut(page)).toHaveCount(0);
});

test("「今すぐ取得」でサーバーがエラーを返すと、取得できなかったと出て、もう一度押せる", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  // What the browser gets when the function crashes or times out on Vercel.
  await page.route("**/*", (route) =>
    "next-action" in route.request().headers()
      ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" })
      : route.fallback(),
  );
  await pressFetch(page);
  await expect(fetchFailure(page)).toHaveText("取得できませんでした。もう一度押してください");
  await expect(fetchCut(page)).toHaveCount(0);
  await expect(fetchButton(page)).toBeEnabled();

  await page.unrouteAll();
  await fetchButton(page).click();
  await expect(page.getByText(/本の新着を追加しました/)).toBeVisible({ timeout: 60_000 });
  await expect(fetchFailure(page)).toHaveCount(0);
});

test("「URL を追加」の通信が失敗すると、メッセージが出て、もう一度押せる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "URL を追加" }).click();
  // Already saved, so the retry needs no network.
  await page.getByPlaceholder("https://…").fill("https://example.com/e2e/1");
  await abortActions(page);
  await page.getByRole("button", { name: "追加して読む" }).click();
  await expect(page.getByText("記事を追加できませんでした。もう一度押してください")).toBeVisible();
  await expect(page).not.toHaveURL(/\/articles\//);

  await page.unrouteAll();
  await page.getByRole("button", { name: "追加して読む" }).click();
  await expect(page).toHaveURL(/\/articles\/\d+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("本番で動くエージェント");
});
