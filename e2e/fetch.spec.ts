import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

// 「今すぐ取得」 and 「URL を追加」 with pages that linkedom / Readability cannot parse. The pages
// come from a local server started here, so nothing reaches the outside network. Every other
// enabled feed in the seed points at a closed local port (e2e/seed.mts).

const cards = (page: Page) => page.getByRole("list", { name: "記事" }).getByRole("listitem");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });
const fetchButton = (page: Page) => page.getByRole("button", { name: "今すぐ取得" });
const abortActions = (page: Page) =>
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

const pages: Record<string, string> = {
  "/posts/good": good("取得テスト 正常な記事"),
  "/posts/empty": empty,
  "/posts/fragment": fragment,
  "/pages/empty": empty,
  "/pages/fragment": fragment,
};

test.describe("本文を取り出せないページ", () => {
  let server: Server;
  let origin: string;
  // The feed is empty while it is added, so its articles come in through 「今すぐ取得」.
  let listItems = false;

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
    // The other enabled feeds in the seed fail, and are listed after the count.
    await expect(page.getByText(/^3 本の新着を追加しました/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);

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

test("「今すぐ取得」の通信が失敗すると、ボタンの下にメッセージが出て、もう一度押せる", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await abortActions(page);
  await fetchButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("取得できませんでした。もう一度押してください");
  await expect(fetchButton(page)).toBeEnabled();

  await page.unrouteAll();
  await fetchButton(page).click();
  await expect(page.getByText(/本の新着を追加しました/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
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
