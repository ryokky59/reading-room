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

// The widest screen with the list beside an open article: from `lg` up the article is a sheet.
const BESIDE = { width: 1000, height: 800 };

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
    // ← on phones, ✕ of the sheet on PCs.
    await page
      .getByRole("link", { name: "戻る", exact: true })
      .or(page.getByRole("button", { name: "記事を閉じる" }))
      .filter({ visible: true })
      .click();
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

test("PC で記事を開くと後ろのボードで薄くなり、ボードに戻ると未読数に入らない。リロードで消える", async ({ page }) => {
  const name = "E2E 開いて戻る";
  await openFolder(page, name);
  await columnRow(page, `${name} A`, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(columnRow(page, `${name} A`, `${name} A1`)).toHaveAttribute("data-seen", "");

  await page.getByRole("button", { name: "記事を閉じる" }).click();
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

test("PC でボードから開いた記事の一覧が届く瞬間に j を押すと、次の記事が開いたまま。戻る・進むで行き来できる", async ({ page }) => {
  const name = "E2E 届く瞬間の j";
  // The list beside an open article: from `lg` up the article is a sheet over the Board.
  await page.setViewportSize(BESIDE);
  await page.addInitScript(() => {
    const w = window as unknown as { keydownListeners: number; pressed: boolean };
    w.keydownListeners = 0;
    w.pressed = false;
    const add = window.addEventListener;
    window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) {
      if (type === "keydown") w.keydownListeners++;
      return (add as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof window.addEventListener;
    // Presses j in the commit that shows `/articles/<id>/list`, before that commit's effects run.
    // On body, not window: the handler reads `e.target.closest`.
    const replace = history.replaceState;
    history.replaceState = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      const result = replace.call(this, data, unused, url);
      if (!w.pressed && /^\/articles\/\d+\/list/.test(String(url))) {
        w.pressed = true;
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
      }
      return result;
    };
  });
  await openFolder(page, name);
  const id = async (title: string) =>
    /\/articles\/(\d+)/.exec((await columnRow(page, `${name} A`, title).getByRole("link").getAttribute("href")) ?? "")?.[1];
  const [a1, a2] = [await id(`${name} A1`), await id(`${name} A2`)];
  expect(a1).toBeTruthy();
  expect(a2).toBeTruthy();

  // Holds the list until the article listens for keys, so j comes while the list arrives.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/articles\/\d+\/list\?/, async (route) => {
    await held;
    await route.fallback();
  });
  const before = await page.evaluate(() => (window as unknown as { keydownListeners: number }).keydownListeners);
  await columnRow(page, `${name} A`, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  // The article's key listener is added a moment after its heading shows.
  await page.waitForFunction((n) => (window as unknown as { keydownListeners: number }).keydownListeners > n, before);
  release();
  await expect.poll(() => page.evaluate(() => (window as unknown as { pressed: boolean }).pressed)).toBe(true);

  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(page).toHaveURL(new RegExp(`/articles/${a2}\\?f=\\d+&s=\\d+$`));
  await page.waitForTimeout(500);
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(page).toHaveURL(new RegExp(`/articles/${a2}\\?f=\\d+&s=\\d+$`));

  await page.goBack();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await expect(page).toHaveURL(new RegExp(`/articles/${a1}\\?f=\\d+&s=\\d+$`));
  await page.goForward();
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(page).toHaveURL(new RegExp(`/articles/${a2}\\?f=\\d+&s=\\d+$`));
});

test("スマホでボードから開いて戻ると未読数に入らず、行は薄く残る。ブラウザの戻るでも同じ。リロードで消える @mobile", async ({ page }) => {
  const name = "E2E スマホで開いて戻る";
  await openFolder(page, name);
  await columnRow(page, `${name} A`, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(unread(page)).toHaveText(/^2 本/);
  await expect(columnRow(page, `${name} A`, `${name} A1`)).toHaveAttribute("data-seen", "");

  await columnRow(page, `${name} A`, `${name} A2`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A2`);
  await page.goBack();
  await expect(unread(page)).toHaveText(/^1 本/);
  await expect(columnRow(page, `${name} A`, `${name} A2`)).toHaveAttribute("data-seen", "");
  await expect(chip(folderNav(page), name, 1)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`${name} A2`)).toHaveCount(0);
  await expect(unread(page)).toHaveText(/^1 本/);
});

test("PC で開いている記事を「未読に戻す」と、記事が閉じて未読に戻り、次の更新でも未読のまま", async ({ page }) => {
  const name = "E2E 開いた記事を戻す";
  // The list beside an open article: from `lg` up the article is a sheet over the Board.
  await page.setViewportSize(BESIDE);
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

test("PC で「既読を含む」の既読カードをスキップして「元に戻す」と、薄いまま戻って未読数は変わらない", async ({ page }) => {
  const name = "E2E 既読をスキップして戻す";
  const toast = page.getByRole("status");
  await openFolder(page, name);
  await openColumn(page, `${name} B`);
  await includeSeen(page).click();
  await expect(card(page, `${name} 既読`)).toHaveAttribute("data-seen", "");
  await expect(unread(page)).toHaveText(/^1 本/);

  // The last card of the list, so nothing opens next and no other article becomes seen.
  await card(page, `${name} 既読`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} 既読`);
  await page.keyboard.press("s");
  await expect(toast.getByText("スキップしました")).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  await expect(card(page, `${name} 既読`)).toHaveCount(0);

  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(card(page, `${name} 既読`)).toHaveAttribute("data-seen", "");
  await expect(card(page, `${name} 既読`).getByRole("button", { name: "未読に戻す" })).toBeVisible();
  await expect(card(page, `${name} B1`)).not.toHaveAttribute("data-seen", "");
  await expect(unread(page)).toHaveText(/^1 本/);

  await page.goto("/");
  await expect(chip(folderNav(page), name, 3)).toBeVisible();
  await chip(folderNav(page), name, 3).click();
  await expect(unread(page)).toHaveText(/^3 本/);
});

test("PC で読了を「未読に戻す」と一覧に未読で出て、未読数が 1 増える。リロードしても未読のまま", async ({ page }) => {
  const name = "E2E PC で読了を戻す";
  await openFolder(page, name);
  await page.goto("/read");
  await page.getByRole("link", { name: new RegExp(`${name} 読了`) }).click();
  await expect(heading(page)).toHaveText(`${name} 読了`);
  await page.getByRole("button", { name: "未読に戻す" }).click();
  await expect(page).toHaveURL("/");
  await expect(heading(page)).toHaveCount(0);

  await chip(folderNav(page), name, 4).click();
  await expect(unread(page)).toHaveText(/^4 本/);
  await expect(columnRow(page, `${name} B`, `${name} 読了`)).not.toHaveAttribute("data-seen", "");
  await openColumn(page, `${name} B`);
  await expect(card(page, `${name} 読了`)).not.toHaveAttribute("data-seen", "");
  await expect(card(page, `${name} 読了`)).toHaveCSS("opacity", "1");

  // The article's page was refreshed right after it was left; that must not have marked it seen again.
  await page.reload();
  await expect(unread(page)).toHaveText(/^2 本/);
  await expect(card(page, `${name} 読了`)).not.toHaveAttribute("data-seen", "");
  await page.goto("/");
  await expect(chip(folderNav(page), name, 4)).toBeVisible();
  await page.goto("/read");
  await expect(page.getByText(`${name} 読了`)).toHaveCount(0);
});

// Where a card is in the page and how tall it is.
const place = async (page: Page, title: string) => {
  const box = (await card(page, title).boundingBox())!;
  return { y: box.y, height: box.height };
};

test("PC で記事を開いても j で進んでも、カードの高さと下のカードの位置が変わらない", async ({ page }) => {
  const name = "E2E カードの高さ";
  const titles = [`${name} A1`, `${name} A2`, `${name} B1`, `${name} 既読`];
  const places = () => Promise.all(titles.map((t) => place(page, t)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolder(page, name);
  await includeSeen(page).click();
  await expect(card(page, `${name} 既読`)).toBeVisible();
  // A seen card is as tall as an unread one with the same lines (the seen one has one more: its original title).
  const unseen = await places();
  expect(unseen[0].height).toBe(unseen[1].height);

  await card(page, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await expect(card(page, `${name} A1`)).toHaveAttribute("aria-current", "true");
  // Opening must not move the cards either; the list is as wide as before, beside the article.
  await expect.poll(places).toEqual(unseen);

  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");
  await expect(card(page, `${name} A2`)).toHaveAttribute("aria-current", "true");
  expect(await places()).toEqual(unseen);

  // The open card and the seen one offer 未読に戻す where スキップ was; unread cards keep スキップ.
  for (const title of titles.slice(0, 2)) {
    await expect(card(page, title).getByRole("button", { name: "未読に戻す" })).toBeVisible();
    await expect(card(page, title).getByRole("button", { name: "スキップ" })).toHaveCount(0);
  }
  await expect(card(page, `${name} B1`).getByRole("button", { name: "スキップ" })).toBeVisible();
  await expect(card(page, `${name} B1`).getByRole("button", { name: "未読に戻す" })).toHaveCount(0);
});

test("既読カードの「未読に戻す」が、行の文字と重ならずカードからはみ出さない。スマホの縦・横と PC で押せる", async ({ page }) => {
  const name = "E2E 未読に戻すの幅";
  const seen = card(page, `${name} 既読`);
  const button = seen.getByRole("button", { name: "未読に戻す" });
  // The card's last row at its fullest: 「15分」「日本語で読める」「対話中」.
  const fits = async (cardWidth?: number) => {
    await expect(button).toBeVisible();
    const [c, b] = [(await seen.boundingBox())!, (await button.boundingBox())!];
    if (cardWidth) expect(c.width).toBe(cardWidth);
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height);
    for (const text of ["15分", "日本語で読める", "対話中"]) {
      const t = (await seen.getByText(text, { exact: true }).boundingBox())!;
      // On the button's row, and ending before it.
      expect(t.y + t.height).toBeGreaterThan(b.y);
      expect(t.x + t.width).toBeLessThanOrEqual(b.x);
    }
    await button.click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolder(page, name);
  await includeSeen(page).click();
  await expect(seen).toBeVisible();
  await fits();
  // Beside an open article, where the list is a narrow pane (below `lg`; above it the article is a
  // sheet over the list).
  await page.setViewportSize(BESIDE);
  await card(page, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await fits();
  await page.setViewportSize({ width: 844, height: 390 });
  await fits(247);
  // Phones show the list alone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(heading(page)).toHaveCount(0);
  await fits();

  await button.click();
  await expect(seen).not.toHaveAttribute("data-seen", "");
  await expect(button).toHaveCount(0);
  await expect(seen.getByRole("button", { name: "スキップ" })).toBeVisible();
});

test("listed Cookie に範囲外の id や時刻、文字列が入っていても一覧とボードが開く", async ({ page, context, baseURL }) => {
  for (const value of [
    "9999999999999999~9999999999~",
    "1~2147483648~5-abc.none-1e400.-1-0.0-0.2147483648-8640000000000001",
    "abc",
    "1e400~NaN~..%00~~",
  ]) {
    await page.goto("/");
    await expect(unread(page)).toBeVisible();
    // A full load writes the cookie anew, so it is set again for the router's requests.
    await context.addCookies([{ name: "listed", value, url: baseURL! }]);
    await includeSeen(page).click();
    await expect(page).toHaveURL(/\/\?a=1$/);
    await expect(list(page)).toBeVisible();
    await context.addCookies([{ name: "listed", value, url: baseURL! }]);
    await includeSeen(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(unread(page)).toBeVisible();
    // And on the request of a full load.
    await context.addCookies([{ name: "listed", value, url: baseURL! }]);
    await page.reload();
    await expect(unread(page)).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  }
});

test("PC で記事を開いたあとのフルロードでは、最初の HTML から開いた記事が無い。次の更新でも戻らない", async ({ page, context }) => {
  const name = "E2E 開いてフルロード";
  await openFolder(page, name);
  const folderUrl = page.url();
  await openColumn(page, `${name} A`);
  const listUrl = page.url();
  await card(page, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");
  const listed = async () => (await context.cookies()).find((c) => c.name === "listed")?.value;
  expect(await listed()).toMatch(/^\d+~~$/);

  // The list, then the Board, as the browser's own request gets them.
  for (const url of [listUrl, folderUrl]) {
    const html = await (await page.goto(url))!.text();
    expect(html).toContain(`${name} A2`);
    expect(html).not.toContain(`${name} A1`);
    await expect(page.getByText(`${name} A2`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${name} A1`, { exact: true })).toHaveCount(0);
    // The cookie starts again from this load, without asking for the list again.
    const before = await listed();
    await expect.poll(listed).toMatch(/^\d+~~$/);
    expect(Number((await listed())!.split("~")[0])).toBeGreaterThanOrEqual(Number(before!.split("~")[0]));
  }
  await includeSeen(page).click();
  await expect(page).toHaveURL(/&a=1$/);
  await includeSeen(page).click();
  await expect(page).not.toHaveURL(/&a=1$/);
  await expect(page.getByText(`${name} A2`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${name} A1`, { exact: true })).toHaveCount(0);
  await expect(unread(page)).toHaveText(/^2 本/);
});

test("PC で記事を開いたままリロードすると、前に開いた記事は一覧に薄く残る", async ({ page }) => {
  const name = "E2E 開いたままリロード";
  await openFolder(page, name);
  await openColumn(page, `${name} A`);
  await card(page, `${name} A1`).getByRole("link").click();
  await expect(heading(page)).toHaveText(`${name} A1`);
  await page.keyboard.press("j");
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");

  // The document is the article's; the list beside it comes by the router, with the cookie.
  await page.reload();
  await expect(heading(page)).toHaveText(`${name} A2`);
  await expect(card(page, `${name} A2`)).toHaveAttribute("aria-current", "true");
  await expect(card(page, `${name} A1`)).toHaveAttribute("data-seen", "");
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
});
