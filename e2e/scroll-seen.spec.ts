import { expect, test, type Locator, type Page } from "@playwright/test";
import { openFeed, openTab } from "./nav";

// Seen by scrolling past (SeenOnScroll). Each test uses its own folder from the end of
// e2e/seed.mts: site A with 25 short articles (32 in 位置), and in some a site B.

const list = (page: Page) => page.getByRole("list", { name: "記事" });
const cards = (page: Page) => list(page).locator("li[data-article]");
const card = (page: Page, title: string) => cards(page).filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const seenCards = (page: Page) => list(page).locator("li[data-article][data-seen]");
const line = (scope: Page | Locator) => scope.locator("[data-seen-line]");
const undo = (scope: Page | Locator) => line(scope).getByRole("button", { name: "元に戻す" });
const unread = (page: Page) => page.getByText(/^\d+ 本/);
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const columnUnread = (page: Page, name: string) => column(page, name).getByLabel(/^未読 \d+ 本$/);
const tab = (page: Page, folder: string, count: number) =>
  page.getByRole("navigation", { name: "フォルダ" }).getByRole("link", { name: new RegExp(`^${folder}\\s*${count}$`) });
const savedAlert = (page: Page) => page.getByRole("alert").filter({ hasText: /^保存できませんでした$/ });
const retryAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" });

// A list counts nothing for its first second (the page is still being put in place).
const settle = (page: Page) => page.waitForTimeout(1200);
// Half a second above the edge, a second until the save, and the request.
const NOTHING_MS = 2500;

/** How many rows the line says are seen, once it shows. */
async function lineCount(scope: Page | Locator) {
  await expect(line(scope)).toBeVisible();
  const text = (await line(scope).innerText()).replace(/\s+/g, " ");
  return Number(/ここまで既読 · (\d+) 件/.exec(text)![1]);
}

/** Scrolls with the wheel over `over` (the page when left out), as the owner would. */
async function wheel(page: Page, dy: number, over?: Locator) {
  const { width, height } = page.viewportSize()!;
  const box = over ? (await over.boundingBox())! : { x: 0, y: 0, width, height };
  // A long list reaches below the screen: the pointer stays on the part that shows.
  const bottom = Math.min(box.y + box.height, height);
  await page.mouse.move(box.x + box.width / 2, (Math.max(box.y, 0) + bottom) / 2);
  await page.mouse.wheel(0, dy);
}

/**
 * Presses without scrolling to it first, as Playwright's click would: the line is just above the
 * screen, and scrolling up to it would bring the rows above it back down.
 */
const press = (target: Locator) => target.evaluate((el: HTMLElement) => el.click());

const failActions = (page: Page) =>
  page.route("**/*", (route) => ("next-action" in route.request().headers() ? route.abort() : route.fallback()));

/** The title of the first card not above the header. */
const topCard = (page: Page) =>
  page.evaluate(() => {
    const edge = document.querySelector("[data-app-header]")!.getBoundingClientRect().bottom;
    const first = [...document.querySelectorAll("li[data-article]")].find((li) => li.getBoundingClientRect().bottom > edge);
    return first?.querySelector("h2")?.textContent;
  });

test.describe("スマホ @mobile", () => {
  test("流した記事が薄くなり、線が出て未読数が減る。元に戻せて、リロードで一覧から消える @mobile", async ({ page }) => {
    const name = "E2E 流し読み スマホ";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(25);
    await expect(unread(page)).toHaveText(/^25 本/);
    await settle(page);

    await wheel(page, 600);
    const n = await lineCount(page);
    expect(n).toBeGreaterThanOrEqual(2);
    // The first n, with the line right after them.
    await expect(seenCards(page)).toHaveCount(n);
    await expect(cards(page).nth(n - 1)).toHaveAttribute("data-seen", "");
    expect(await line(page).evaluate((el) => el.previousElementSibling?.querySelector("h2")?.textContent)).toBe(`${name} A ${n}`);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - n} 本`));
    // Faded in place: no card has left the list.
    await expect(cards(page)).toHaveCount(25);

    await press(undo(page));
    await expect(line(page)).toHaveCount(0);
    await expect(seenCards(page)).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^25 本/);
    // They stay unread while they stay above the screen.
    await page.waitForTimeout(NOTHING_MS);
    await expect(seenCards(page)).toHaveCount(0);

    // Further down, only the rows that pass now count.
    await wheel(page, 500);
    const more = await lineCount(page);
    await expect(seenCards(page)).toHaveCount(more);
    await expect(cards(page).first()).not.toHaveAttribute("data-seen", "");
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - more} 本`));

    await page.reload();
    await expect(cards(page)).toHaveCount(25 - more);
    await expect(seenCards(page)).toHaveCount(0);
    await expect(line(page)).toHaveCount(0);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - more} 本`));
    await page.getByRole("switch", { name: "既読を含む" }).click();
    await expect(cards(page)).toHaveCount(25);
  });

  test("保存できなければ行と未読数が戻ってメッセージが出て、線は出ない。次のスクロールでもう一度試す @mobile", async ({ page }) => {
    const name = "E2E 流し読み 失敗";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    await failActions(page);

    await wheel(page, 600);
    // Faded at once, then put back.
    await expect(seenCards(page).first()).toBeVisible();
    await expect(savedAlert(page)).toBeVisible();
    await expect(seenCards(page)).toHaveCount(0);
    await expect(line(page)).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^25 本/);

    await page.unroute("**/*");
    await wheel(page, 100);
    const n = await lineCount(page);
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(seenCards(page)).toHaveCount(n);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - n} 本`));
  });

  test("「元に戻す」が保存できなければメッセージが出て、線と薄い行はそのまま。もう一度押せる @mobile", async ({ page }) => {
    const name = "E2E 流し読み 取消失敗";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    await wheel(page, 600);
    const n = await lineCount(page);

    await failActions(page);
    await undo(page).click();
    await expect(retryAlert(page)).toBeVisible();
    await expect(line(page)).toBeVisible();
    await expect(seenCards(page)).toHaveCount(n);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - n} 本`));

    await page.unroute("**/*");
    await undo(page).click();
    await expect(line(page)).toHaveCount(0);
    await expect(seenCards(page)).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^25 本/);
  });

  test("記事を開いて ← で戻っても、戻った位置より上の行は既読にならない。開いた記事は薄く残り、リロードで消える @mobile", async ({ page }) => {
    const name = "E2E 流し読み 開く";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    // Unread rows above the screen: scrolled past, then put back.
    await wheel(page, 600);
    const n = await lineCount(page);
    await press(undo(page));
    await expect(seenCards(page)).toHaveCount(0);

    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(300);
    const title = `${name} A ${n + 3}`;
    await press(card(page, title).getByRole("link").first());
    await expect(heading(page)).toHaveText(title);
    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(heading(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    // Only the opened one: it stays, faded, and is not counted.
    await expect(card(page, title)).toHaveAttribute("data-seen", "");
    await expect(unread(page)).toHaveText(/^24 本/);
    await page.waitForTimeout(NOTHING_MS);
    await expect(seenCards(page)).toHaveCount(1);
    await expect(line(page)).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^24 本/);

    // The same with the browser's back.
    const next = `${name} A ${n + 4}`;
    await press(card(page, next).getByRole("link").first());
    await expect(heading(page)).toHaveText(next);
    await page.goBack();
    await expect(heading(page)).toHaveCount(0);
    await expect(card(page, next)).toHaveAttribute("data-seen", "");
    await page.waitForTimeout(NOTHING_MS);
    await expect(seenCards(page)).toHaveCount(2);
    await expect(unread(page)).toHaveText(/^23 本/);

    await page.reload();
    await expect(cards(page)).toHaveCount(23);
    await expect(card(page, title)).toHaveCount(0);
    await expect(unread(page)).toHaveText(/^23 本/);
  });

  test("記事を開いている間に上の 8 本が既読になっても、← で戻った画面の先頭のカードは同じで、既読の行は薄く残る @mobile", async ({
    page,
    browser,
  }) => {
    const name = "E2E 流し読み 位置";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(30);
    await card(page, `${name} A 15`).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 150));
    const y = await page.evaluate(() => window.scrollY);
    const top = await topCard(page);
    const firstEight = await cards(page).evaluateAll((all) => all.slice(0, 8).map((li) => li.querySelector("a")!.getAttribute("href")!));

    await card(page, `${name} A 15`).getByRole("link").first().click();
    await expect(heading(page)).toHaveText(`${name} A 15`);
    // Elsewhere (another device), the first eight are opened.
    const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const elsewhere = await other.newPage();
    for (const href of firstEight) {
      await elsewhere.goto(href);
      await expect(elsewhere.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await other.close();

    await page.getByRole("link", { name: "戻る", exact: true }).click();
    await expect(heading(page)).toHaveCount(0);
    // The refreshed list has them as seen, in place.
    await expect(cards(page).nth(7)).toHaveAttribute("data-seen", "");
    await expect(cards(page).first()).toHaveAttribute("data-seen", "");
    await expect(cards(page)).toHaveCount(30);
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    expect(await topCard(page)).toBe(top);
  });

  test("一覧で流してから「‹ ボード」で戻ると、セクションの見出し 3 本は薄く、「もっと見る」の件数が未読数と合う。リロードで消える @mobile", async ({
    page,
  }) => {
    const name = "E2E 流し読み ボードへ";
    await openFeed(page, name);
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    await wheel(page, 900);
    const n = await lineCount(page);
    expect(n).toBeGreaterThanOrEqual(3);

    await page.getByRole("link", { name: "‹ ボード" }).click();
    const section = column(page, `${name} A`);
    const shown = section.locator("li[data-row]:visible");
    await expect(shown).toHaveCount(3);
    await expect(section.locator("li[data-row][data-seen]:visible")).toHaveCount(3);
    await expect(columnUnread(page, `${name} A`)).toHaveText(String(25 - n));
    await expect(section.getByRole("link", { name: `もっと見る(あと ${25 - n} 件)›` })).toBeVisible();
    // A stacked Board has no line.
    await expect(line(page)).toHaveCount(0);

    await page.reload();
    await expect(shown).toHaveCount(3);
    await expect(section.locator("li[data-row][data-seen]")).toHaveCount(0);
    await expect(columnUnread(page, `${name} A`)).toHaveText(String(25 - n));
    await expect(section.getByRole("link", { name: `もっと見る(あと ${25 - n - 3} 件)›` })).toBeVisible();
  });
});

test.describe("PC 幅", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("1 列だけをスクロールするとその列にだけ線が出る。別の列の「すべて既読」でも線と薄い行は残る", async ({ page }) => {
    const name = "E2E 流し読み 列";
    const [a, b] = [`${name} A`, `${name} B`];
    await openTab(page, name);
    await expect(tab(page, name, 50)).toBeVisible();
    await settle(page);

    await wheel(page, 500, column(page, a).getByRole("list"));
    const n = await lineCount(column(page, a));
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(column(page, a).locator("li[data-row][data-seen]")).toHaveCount(n);
    await expect(columnUnread(page, a)).toHaveText(String(25 - n));
    await expect(tab(page, name, 50 - n)).toBeVisible();
    await expect(unread(page)).toHaveText(new RegExp(`^${50 - n} 本`));
    // The other column is as it was.
    await expect(line(column(page, b))).toHaveCount(0);
    await expect(column(page, b).locator("li[data-row][data-seen]")).toHaveCount(0);
    await expect(columnUnread(page, b)).toHaveText("25");

    await column(page, b).getByRole("button", { name: "すべて既読" }).click();
    await expect(column(page, b).getByRole("listitem")).toHaveText(["未読はありません"]);
    await expect(columnUnread(page, b)).toHaveText("0");
    await expect(tab(page, name, 25 - n)).toBeVisible();
    await expect(line(column(page, a))).toContainText(`ここまで既読 · ${n} 件`);
    await expect(column(page, a).locator("li[data-row][data-seen]")).toHaveCount(n);
    await expect(column(page, a).locator("li[data-row]")).toHaveCount(25);

    await undo(column(page, a)).click();
    await expect(line(page)).toHaveCount(0);
    await expect(column(page, a).locator("li[data-row][data-seen]")).toHaveCount(0);
    await expect(columnUnread(page, a)).toHaveText("25");
    await expect(tab(page, name, 25)).toBeVisible();
    // B's stay seen.
    await expect(column(page, b).getByRole("listitem")).toHaveText(["未読はありません"]);
  });

  test("フォルダの「すべて既読」の後は、ボードの薄い行も線もすべて消える", async ({ page }) => {
    const name = "E2E 流し読み フォルダ";
    await openTab(page, name);
    await expect(tab(page, name, 28)).toBeVisible();
    await settle(page);
    await wheel(page, 500, column(page, `${name} A`).getByRole("list"));
    await lineCount(column(page, `${name} A`));

    // The folder's button, above the columns.
    await page.getByRole("button", { name: "すべて既読" }).first().click();
    await expect(tab(page, name, 0)).toBeVisible();
    await expect(line(page)).toHaveCount(0);
    await expect(page.locator("li[data-row]")).toHaveCount(0);
    await expect(column(page, `${name} A`).getByRole("listitem")).toHaveText(["未読はありません"]);
    await expect(column(page, `${name} B`).getByRole("listitem")).toHaveText(["未読はありません"]);
  });

  test("一覧のペインでも線が出て、記事を開いても j で進んでも残る。フルロードの最初の HTML には流した記事が無い", async ({ page }) => {
    const name = "E2E 流し読み PC 一覧";
    await openFeed(page, name);
    const listUrl = page.url();
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    await wheel(page, 600, list(page));
    const n = await lineCount(page);
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - n} 本`));

    await card(page, `${name} A ${n + 2}`).getByRole("link").first().click();
    await expect(heading(page)).toHaveText(`${name} A ${n + 2}`);
    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText(`${name} A ${n + 3}`);
    await expect(line(page)).toContainText(`ここまで既読 · ${n} 件`);
    await expect(cards(page)).toHaveCount(25);
    await expect(cards(page).first()).toHaveAttribute("data-seen", "");

    const html = await (await page.goto(listUrl))!.text();
    expect(html).not.toContain(`${name} A 1<`);
    expect(html).toContain(`${name} A 25<`);
    await expect(cards(page)).toHaveCount(25 - n - 2);
    await expect(seenCards(page)).toHaveCount(0);
  });

  test("「既読を含む」の一覧と、サイトを選んでいない一覧では、スクロールしても線が出ず既読にならない", async ({ page }) => {
    const name = "E2E 流し読み 対象外";
    await openFeed(page, name);
    const feedUrl = page.url();
    const folder = new URL(feedUrl).searchParams.get("f");
    const href = await cards(page).nth(20).getByRole("link").first().getAttribute("href");

    for (const url of [`${feedUrl}&a=1`, `/?f=${folder}&a=1`, `${href!.split("?")[0]}?f=${folder}`]) {
      await page.goto(url);
      await expect(cards(page)).toHaveCount(25);
      await settle(page);
      await wheel(page, 600, list(page));
      await page.waitForTimeout(NOTHING_MS);
      await expect(line(page)).toHaveCount(0);
      // The article of the last URL is open, which shows as chosen, not as seen.
      await expect(seenCards(page)).toHaveCount(0);
    }
    await page.goto(feedUrl);
    await expect(cards(page)).toHaveCount(24);
  });
});

test.describe("横向きのスマホ 844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("ボードは縦積みのままで、スクロールしても線が出ず既読にならない。フィード一覧では線が出る", async ({ page }) => {
    const name = "E2E 流し読み 横向き";
    await openTab(page, name);
    const section = column(page, `${name} A`);
    await expect(section.locator("li[data-row]:visible")).toHaveCount(3);
    await settle(page);
    await wheel(page, 800);
    await page.waitForTimeout(NOTHING_MS);
    await expect(line(page)).toHaveCount(0);
    await expect(page.locator("li[data-row][data-seen]")).toHaveCount(0);
    await expect(columnUnread(page, `${name} A`)).toHaveText("25");

    await section.getByRole("heading", { level: 3 }).getByRole("link").click();
    await expect(cards(page)).toHaveCount(25);
    await settle(page);
    await wheel(page, 600, list(page));
    const n = await lineCount(page);
    await expect(seenCards(page)).toHaveCount(n);
    await expect(unread(page)).toHaveText(new RegExp(`^${25 - n} 本`));
  });
});
