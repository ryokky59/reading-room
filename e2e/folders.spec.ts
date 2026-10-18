import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

// Folder rows used here are seeded in e2e/seed.mts; tests that change state use their own.

const folder = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const feedRow = (page: Page, folderName: string, feedName: string) =>
  folder(page, folderName).getByRole("listitem").filter({ hasText: feedName });
const folderOrder = (page: Page) =>
  page.locator("main section").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

test("移行後、既存の Tech / Business のフィードが同名のフォルダに入っている", async ({ page }) => {
  await page.goto("/feeds");
  await expect(feedRow(page, "Tech", "Hacker News (100pt以上)")).toBeVisible();
  await expect(feedRow(page, "Tech", "Zenn トレンド")).toBeVisible();
  await expect(feedRow(page, "Business", "Stratechery")).toBeVisible();
  await expect(feedRow(page, "Business", "日経クロステック")).toBeVisible();
  await expect(feedRow(page, "Tech", "Stratechery")).toHaveCount(0);
  // The add form offers the folders instead of Tech / Business.
  const options = await page.getByRole("combobox", { name: "追加先のフォルダ" }).getByRole("option").allTextContents();
  expect(options.slice(0, 2)).toEqual(["Tech", "Business"]);
  expect(options.at(-1)).toBe("未分類");
  await expect(page.getByRole("radio")).toHaveCount(0);
});

test("フォルダを作成・名前変更・並べ替え・削除できる", async ({ page }) => {
  await page.goto("/feeds");
  await page.getByRole("textbox", { name: "新しいフォルダ名" }).fill("E2E 新フォルダ");
  await page.getByRole("button", { name: "フォルダを作成" }).click();
  await expect(folder(page, "E2E 新フォルダ")).toBeVisible();
  expect((await folderOrder(page)).at(-1)).toBe("E2E 新フォルダ");

  const created = folder(page, "E2E 新フォルダ");
  await created.getByRole("button", { name: /を編集$/ }).click();
  await created.getByRole("textbox", { name: "フォルダ名" }).fill("E2E 改名フォルダ");
  await created.getByRole("button", { name: "名前を変更" }).click();
  await expect(folder(page, "E2E 改名フォルダ")).toBeVisible();
  await expect(folder(page, "E2E 新フォルダ")).toHaveCount(0);

  // A second new folder lands below it; moving it up puts it above.
  await page.getByRole("textbox", { name: "新しいフォルダ名" }).fill("E2E 後のフォルダ");
  await page.getByRole("button", { name: "フォルダを作成" }).click();
  await expect.poll(() => folderOrder(page).then((o) => o.slice(-2))).toEqual(["E2E 改名フォルダ", "E2E 後のフォルダ"]);
  await expect(page.getByRole("button", { name: "E2E 後のフォルダ を下へ" })).toBeDisabled();

  await page.getByRole("button", { name: "E2E 後のフォルダ を上へ" }).click();
  await expect.poll(() => folderOrder(page).then((o) => o.slice(-2))).toEqual(["E2E 後のフォルダ", "E2E 改名フォルダ"]);
  await page.reload();
  expect((await folderOrder(page)).slice(-2)).toEqual(["E2E 後のフォルダ", "E2E 改名フォルダ"]);

  await page.getByRole("button", { name: "E2E 後のフォルダ を下へ" }).click();
  await expect.poll(() => folderOrder(page).then((o) => o.slice(-2))).toEqual(["E2E 改名フォルダ", "E2E 後のフォルダ"]);
  expect((await folderOrder(page)).slice(0, 2)).toEqual(["Tech", "Business"]);

  for (const name of ["E2E 改名フォルダ", "E2E 後のフォルダ"]) {
    const f = folder(page, name);
    await f.getByRole("button", { name: /を編集$/ }).click();
    await f.getByRole("button", { name: "フォルダを削除" }).click();
    await expect(folder(page, name)).toHaveCount(0);
  }
});

test("フィードを別のフォルダに移すと、移した先のフォルダに表示される", async ({ page }) => {
  await page.goto("/feeds");
  await expect(feedRow(page, "Tech", "E2E 移動するフィード")).toBeVisible();
  await page.getByRole("combobox", { name: "E2E 移動するフィード のフォルダ" }).selectOption({ label: "E2E 移動先" });
  await expect(feedRow(page, "E2E 移動先", "E2E 移動するフィード")).toBeVisible();
  await expect(feedRow(page, "Tech", "E2E 移動するフィード")).toHaveCount(0);
  await page.reload();
  await expect(feedRow(page, "E2E 移動先", "E2E 移動するフィード")).toBeVisible();
});

test("フォルダを削除しても、フィードと記事は残り「未分類」に表示される", async ({ page }) => {
  await page.goto("/feeds");
  await expect(feedRow(page, "E2E 消すフォルダ", "E2E 残るフィード")).toContainText("記事 1 本");
  const doomed = folder(page, "E2E 消すフォルダ");
  await doomed.getByRole("button", { name: /を編集$/ }).click();
  await doomed.getByRole("button", { name: "フォルダを削除" }).click();
  await expect(folder(page, "E2E 消すフォルダ")).toHaveCount(0);
  await expect(feedRow(page, "未分類", "E2E 残るフィード")).toContainText("記事 1 本");

  await page.goto("/");
  await expect(page.getByText("残るフィードの記事")).toBeVisible();
});

test.describe("記事とフィードのひもづけ", () => {
  // A local site with an RSS feed, so importing needs no outside network.
  let server: Server;
  let origin: string;
  const post = (n: number) =>
    `<!doctype html><html><head><title>ローカル記事 ${n}</title></head><body><article><h1>ローカル記事 ${n}</h1>${"<p>ローカルの本文です。テスト用の段落をいくつか並べています。</p>".repeat(8)}</article></body></html>`;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const now = new Date().toUTCString();
      if (req.url === "/rss.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>ローカル RSS</title><link>${origin}/</link>
${[1, 2].map((n) => `<item><title>ローカル記事 ${n}</title><link>${origin}/posts/${n}</link><pubDate>${now}</pubDate></item>`).join("")}
</channel></rss>`);
      } else if (req.url?.startsWith("/posts/") || req.url === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(post(req.url === "/page" ? 99 : Number(req.url.split("/").pop())));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test("新しく取り込んだ記事はフィードにひもづき、「URL を追加」の記事はひもづかない", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/feeds");
    await page.getByLabel("サイトを追加").fill(`${origin}/rss.xml`);
    // Named after the host, which is also the source of an article added by URL.
    await page.getByPlaceholder("表示名(空ならサイト名を使います)").fill("127.0.0.1");
    await page.getByRole("combobox", { name: "追加先のフォルダ" }).selectOption({ label: "Business" });
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByText("「127.0.0.1」を追加し、2 本を取り込みました")).toBeVisible({ timeout: 60_000 });
    await expect(feedRow(page, "Business", "127.0.0.1")).toContainText("記事 2 本");

    await page.goto("/");
    await page.getByRole("button", { name: "URL を追加" }).click();
    await page.getByPlaceholder("https://…").fill(`${origin}/page`);
    await page.getByRole("button", { name: "追加して読む" }).click();
    await expect(page).toHaveURL(/\/articles\/\d+/, { timeout: 60_000 });

    await page.goto("/feeds");
    await expect(feedRow(page, "Business", "127.0.0.1")).toContainText("記事 2 本");
  });
});

test("スマホ幅でフィード画面を操作できる @mobile", async ({ page }) => {
  await page.goto("/feeds");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page
    .getByRole("combobox", { name: "E2E スマホで移動するフィード のフォルダ" })
    .selectOption({ label: "E2E 移動先" });
  await expect(feedRow(page, "E2E 移動先", "E2E スマホで移動するフィード")).toBeVisible();

  // The edit panel fits on screen.
  const tech = folder(page, "Tech");
  await tech.getByRole("button", { name: /を編集$/ }).click();
  const width = page.viewportSize()!.width;
  for (const name of ["名前を変更", "フォルダを削除"]) {
    const box = (await tech.getByRole("button", { name }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const up = (await page.getByRole("button", { name: "Business を上へ" }).boundingBox())!;
  expect(up.height).toBeGreaterThanOrEqual(32);
});
