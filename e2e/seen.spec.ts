import { expect, test, type Locator, type Page } from "@playwright/test";

// 既読 (seen) apart from 読了 (read). Each test uses its own folder from the end of e2e/seed.mts:
// sites A (2 unread) and B (1 unread, 1 seen, 1 skipped, 1 read).

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) =>
  list(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const unread = (page: Page) => page.getByText(/^\d+ 本/);
const includeSeen = (page: Page) => page.getByRole("switch", { name: "既読を含む" });
const markAll = (page: Page) => page.getByRole("button", { name: "すべて既読" });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const columnRow = (page: Page, site: string, title: string) =>
  column(page, site).getByRole("listitem").filter({ hasText: title });
const openColumn = (page: Page, site: string) => column(page, site).getByRole("link", { name: site, exact: true }).click();
const chip = (nav: Locator, label: string, count: number) =>
  nav.getByRole("link", { name: new RegExp(`^${label}\\s*${count}$`) });
const failed = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" });

async function openFolder(page: Page, name: string, unreadCount = 3) {
  await page.goto("/");
  await chip(folderNav(page), name, unreadCount).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(unread(page)).toHaveText(new RegExp(`^${unreadCount} 本`));
}

for (const [name, tag] of [
  ["E2E PC ですべて既読", ""],
  ["E2E スマホですべて既読", " @mobile"],
]) {
  test(`サイトの「すべて既読」でその記事が消え、サイトとフォルダの未読数が減る${tag}`, async ({ page }) => {
    await openFolder(page, name);
    await openColumn(page, `${name} A`);
    await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
    await expect(list(page).getByRole("listitem")).toHaveCount(2);

    await markAll(page).click();
    // The site has nothing left, so its folder's Board is shown.
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(page.getByText(`${name} A1`)).toHaveCount(0);
    await expect(page.getByText(`${name} A2`)).toHaveCount(0);
    await expect(columnRow(page, `${name} B`, `${name} B1`)).toBeVisible();
    await expect(chip(folderNav(page), name, 1)).toHaveAttribute("aria-current", "page");
    // Phones hide a column with nothing unread, so this looks past the accessibility tree.
    await expect(page.locator("[data-feed]").filter({ hasText: `${name} A` }).getByLabel("未読 0 本")).toBeAttached();
    await expect(column(page, `${name} B`).getByLabel("未読 1 本")).toBeVisible();

    // Still there under 既読を含む; a reload agrees.
    await page.reload();
    await expect(unread(page)).toHaveText(/^1 本/);
    await includeSeen(page).click();
    await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");
  });
}

test("フォルダの「すべて既読」で列が空になり、「すべて」にはフォルダのボタンが出ない", async ({ page }) => {
  const name = "E2E フォルダをすべて既読";
  await openFolder(page, name);
  // The folder's button comes before the columns' own.
  await markAll(page).first().click();
  await expect(page.getByText("未読の記事はありません。", { exact: false })).toBeVisible();
  await expect(chip(folderNav(page), name, 0)).toHaveAttribute("aria-current", "page");
  await expect(markAll(page)).toHaveCount(0);

  await page.goto("/");
  await expect(unread(page)).toBeVisible();
  await expect(markAll(page).first().locator("xpath=ancestor::section[@data-feed]")).toHaveCount(1);
});

test("「すべて既読」が保存できなければメッセージが出て、もう一度押せる", async ({ page }) => {
  const name = "E2E すべて既読に失敗";
  await openFolder(page, name);
  await page.route("**/*", (route) =>
    "next-action" in route.request().headers() ? route.abort() : route.fallback(),
  );
  await markAll(page).first().click();
  await expect(failed(page)).toBeVisible();
  await expect(chip(folderNav(page), name, 3)).toBeVisible();
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);

  await page.unrouteAll();
  await markAll(page).first().click();
  await expect(chip(folderNav(page), name, 0)).toBeVisible();
});

for (const [name, tag] of [
  ["E2E 既読を見返す", ""],
  ["E2E スマホで見返す", " @mobile"],
]) {
  test(`「既読を含む」で既読の記事が薄く出て開ける。「未読に戻す」で未読数が戻る${tag}`, async ({ page }) => {
    await openFolder(page, name);
    await expect(card(page, `${name} 既読`)).toHaveCount(0);

    await includeSeen(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
    await expect(includeSeen(page)).toHaveAttribute("aria-checked", "true");
    await expect(card(page, `${name} 既読`)).toHaveAttribute("data-seen", "");
    await expect(card(page, `${name} 既読`)).toHaveCSS("opacity", "0.6");
    await expect(card(page, `${name} A1`)).not.toHaveAttribute("data-seen", "");
    await expect(card(page, `${name} A1`).getByRole("button", { name: "未読に戻す" })).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^3 本/);
    // Skipped and read articles stay out of it.
    await expect(card(page, `${name} スキップ`)).toHaveCount(0);
    await expect(card(page, `${name} 読了`)).toHaveCount(0);

    // Going back from the article keeps 既読を含む, and the folder chips carry it too.
    await card(page, `${name} 既読`).getByRole("link").click();
    await expect(heading(page)).toHaveText(`${name} 既読`);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&a=1$/);
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/\?f=\d+&a=1$/);
    await expect(card(page, `${name} 既読`)).toBeVisible();
    await expect(unread(page)).toHaveText(/^3 本/);

    await card(page, `${name} 既読`).getByRole("button", { name: "未読に戻す" }).click();
    await expect(unread(page)).toHaveText(/^4 本/);
    await expect(card(page, `${name} 既読`)).not.toHaveAttribute("data-seen", "");
    await expect(card(page, `${name} 既読`).getByRole("button", { name: "未読に戻す" })).toHaveCount(0);

    await includeSeen(page).click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(page.getByText(`${name} 既読`, { exact: true })).toBeVisible();
  });
}

test("一覧の「未読に戻す」が保存できなければメッセージが出て、もう一度押せる", async ({ page }) => {
  const name = "E2E 未読に戻すに失敗";
  await openFolder(page, name);
  await includeSeen(page).click();
  await expect(card(page, `${name} 既読`)).toBeVisible();
  await page.route("**/*", (route) =>
    "next-action" in route.request().headers() ? route.abort() : route.fallback(),
  );
  const button = card(page, `${name} 既読`).getByRole("button", { name: "未読に戻す" });
  await button.click();
  await expect(failed(page)).toBeVisible();
  await expect(unread(page)).toHaveText(/^3 本/);
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);

  await page.unrouteAll();
  await button.click();
  await expect(unread(page)).toHaveText(/^4 本/);
});

test("PC で記事を開くと一覧に薄く残り、ボードに戻ると未読数に入らない。リロードで消える", async ({ page }) => {
  const name = "E2E 開いて戻る";
  await openFolder(page, name);
  await columnRow(page, `${name} A`, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");

  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(unread(page)).toHaveText(/^1 本/);
  await expect(chip(folderNav(page), name, 1)).toBeVisible();
  await expect(columnRow(page, `${name} A`, `${name} A1`)).toHaveAttribute("data-seen", "");
  await expect(columnRow(page, `${name} A`, `${name} A2`)).toHaveAttribute("data-seen", "");
  await expect(columnRow(page, `${name} B`, `${name} B1`)).not.toHaveAttribute("data-seen", "");

  await page.reload();
  await expect(page.getByText(`${name} A1`)).toHaveCount(0);
  await expect(columnRow(page, `${name} B`, `${name} B1`)).toBeVisible();
  await expect(unread(page)).toHaveText(/^1 本/);
});

test("スマホで記事を開いて戻ると未読数に入らず、ボードから消える。ブラウザの戻るでも同じ @mobile", async ({ page }) => {
  const name = "E2E スマホで開いて戻る";
  await openFolder(page, name);
  await columnRow(page, `${name} A`, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(unread(page)).toHaveText(/^2 本/);
  await expect(columnRow(page, `${name} A`, `${name} A1`)).toHaveCount(0);

  await columnRow(page, `${name} A`, `${name} A2`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A2`);
  await page.goBack();
  await expect(unread(page)).toHaveText(/^1 本/);
  await expect(page.getByText(`${name} A2`)).toHaveCount(0);
  await expect(chip(folderNav(page), name, 1)).toBeVisible();
});

test("PC で開いている記事を「未読に戻す」と、記事が閉じて未読に戻り、次の更新でも未読のまま", async ({ page }) => {
  const name = "E2E 開いた記事を戻す";
  await openFolder(page, name);
  await openColumn(page, `${name} A`);
  await card(page, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText(`${name} A2`);
  // The open card is highlighted rather than faded, and still offers the way back.
  await card(page, `${name} A2`).getByRole("button", { name: "未読に戻す" }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+$/);
  await expect(unread(page)).toHaveText(/^1 本/);
  await expect(card(page, `${name} A2`)).not.toHaveAttribute("data-seen", "");

  await page.reload();
  await expect(unread(page)).toHaveText(/^1 本/);
  await expect(card(page, `${name} A2`)).toBeVisible();
});

test("読了を「未読に戻す」と既読でも読了でもなくなる。スキップはどこにも出ず、/read は読了だけ @mobile", async ({
  page,
}) => {
  const name = "E2E 読了を戻す";
  await page.goto("/read");
  await expect(page.getByText(`${name} スキップ`)).toHaveCount(0);
  await expect(page.getByText(`${name} 既読`)).toHaveCount(0);
  await expect(page.getByText(`${name} A1`)).toHaveCount(0);

  await page.getByRole("link", { name: new RegExp(`${name} 読了`) }).click();
  await expect(heading(page)).toHaveText(`${name} 読了`);
  await page.getByRole("button", { name: "未読に戻す" }).click();
  await expect(page).toHaveURL("/");

  await chip(folderNav(page), name, 4).click();
  await expect(unread(page)).toHaveText(/^4 本/);
  await expect(columnRow(page, `${name} B`, `${name} 読了`)).toBeVisible();
  await expect(columnRow(page, `${name} B`, `${name} 読了`)).not.toHaveAttribute("data-seen", "");
  await page.goto("/read");
  await expect(page.getByText(`${name} 読了`)).toHaveCount(0);
});

test("ボードや一覧を表示しているだけでは、見えている記事が既読にならない", async ({ page }) => {
  const name = "E2E 先読み";
  await openFolder(page, name);
  await expect(columnRow(page, `${name} A`, `${name} A1`)).toBeInViewport();
  await expect(columnRow(page, `${name} B`, `${name} B1`)).toBeInViewport();
  await page.waitForTimeout(1500); // Gives the link prefetches time to reach the server.
  await page.reload();
  await expect(unread(page)).toHaveText(/^3 本/);

  await openColumn(page, `${name} A`);
  for (const title of ["A1", "A2"]) await expect(card(page, `${name} ${title}`)).toBeInViewport();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(unread(page)).toHaveText(/^2 本/);
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
});
