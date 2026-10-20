import { expect, test, type Locator, type Page } from "@playwright/test";

// PC panes: the list on the left, the article in the middle, the chat on the right.
// Folders used here are seeded at the end of e2e/seed.mts; tests that read or skip use their own.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const list = (page: Page) => page.getByRole("list", { name: "記事" });
const card = (page: Page, title: string) => list(page).getByRole("listitem").filter({ hasText: title });
const chat = (page: Page) => page.getByRole("complementary", { name: "AI と話す" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** The scrolling list pane around the cards. */
const pane = (page: Page) => list(page).locator("xpath=ancestor::div[@role][1]");
const scrollTop = (el: Locator) => el.evaluate((e) => e.scrollTop);

/** Marks the window; expectNoReload fails if a full page load has replaced it since. */
const markPage = (page: Page) => page.evaluate(() => Object.assign(window, { e2eMark: true }));
const expectNoReload = async (page: Page) =>
  expect(await page.evaluate(() => "e2eMark" in window)).toBe(true);

async function openFolder(page: Page, name: string) {
  await page.goto("/");
  await folderNav(page).getByRole("link", { name: new RegExp(`^${name}\\s*\\d+$`) }).click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
}

test.describe("PC 幅(3 ペイン)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("一覧を残したまま本文が切り替わり、一覧のスクロール位置と絞り込みが保たれる", async ({ page }) => {
    await openFolder(page, "E2E たくさん");
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

    await card(page, "量産記事 21").getByRole("link").click();
    await expect(heading(page)).toHaveText("量産記事 21");
    await expect(card(page, "量産記事 21")).toHaveAttribute("aria-current", "true");
    await expect(card(page, "量産記事 20")).not.toHaveAttribute("aria-current", "true");

    expect(await scrollTop(pane(page))).toBe(top);
    await expect(list(page)).toHaveAttribute("data-e2e", "kept");
    await expect(folderNav(page).getByRole("link", { name: /^E2E たくさん/ })).toHaveAttribute("aria-current", "page");
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
  });

  test("記事を切り替えると対話も切り替わる", async ({ page }) => {
    await page.goto("/");
    await card(page, "対話のある記事").getByRole("link").click();
    await expect(chat(page)).toContainText("要点は E2E テストが通ることです。");
    await card(page, "ビジネスの記事").getByRole("link").click();
    await expect(heading(page)).toHaveText("ビジネスの記事");
    await expect(chat(page)).not.toContainText("要点は E2E テストが通ることです。");
    await expect(chat(page).getByRole("button", { name: "要約してもらう" })).toBeVisible();
  });

  test("読了 / スキップで次の記事が開き、一覧から消える。次がなければ空の状態", async ({ page }) => {
    await openFolder(page, "E2E ペインで読む");
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
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByText("未読の記事はありません。", { exact: true })).toBeVisible();
  });

  test("読み込み済みの最後の記事で読了 / スキップすると、「もっと見る」の先の次の未読が開く", async ({ page }) => {
    await openFolder(page, "E2E 読み進める");
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

    // Nothing unread is left after 32, though 1-29 are still above it: the inbox opens beside the list.
    await page.keyboard.press("e");
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(29);
  });

  test("記事を開いたままチップや「もっと見る」を押すと一覧だけが切り替わり、記事と書きかけの対話が残る", async ({ page }) => {
    await page.goto("/");
    await card(page, "対話のある記事").getByRole("link").click();
    await expect(heading(page)).toHaveText("対話のある記事");
    const path = new URL(page.url()).pathname;
    const input = chat(page).getByPlaceholder("質問や感想を書く");
    await input.fill("書きかけの質問");
    const kept = async () => {
      await expect(heading(page)).toHaveText("対話のある記事");
      await expect(input).toHaveValue("書きかけの質問");
      await expect(chat(page)).toContainText("要点は E2E テストが通ることです。");
    };

    await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+$`));
    await expect(folderNav(page).getByRole("link", { name: /^E2E たくさん/ })).toHaveAttribute("aria-current", "page");
    await expect(list(page).getByRole("heading", { name: "量産記事 1", exact: true })).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    await kept();

    await page.getByRole("link", { name: /もっと見る/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&n=60$`));
    await expect(list(page).getByRole("listitem")).toHaveCount(35);
    await kept();

    await page.getByRole("navigation", { name: "サイト" }).getByRole("link", { name: /^E2E 量産サイト/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+&s=\\d+$`));
    await expect(
      page.getByRole("navigation", { name: "サイト" }).getByRole("link", { name: /^E2E 量産サイト/ }),
    ).toHaveAttribute("aria-current", "page");
    await kept();

    await folderNav(page).getByRole("link", { name: /^すべて/ }).click();
    await expect(page).toHaveURL(path);
    await expect(card(page, "対話のある記事")).toHaveAttribute("aria-current", "true");
    await kept();

    // The article URL now carries the list's filter: a reload shows both again.
    await folderNav(page).getByRole("link", { name: /^E2E たくさん\s*\d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?f=\\d+$`));
    const filtered = new URL(page.url()).search;
    await page.reload();
    await expect(heading(page)).toHaveText("対話のある記事");
    await expect(folderNav(page).getByRole("link", { name: /^E2E たくさん/ })).toHaveAttribute("aria-current", "page");
    await expect(list(page).getByRole("listitem")).toHaveCount(30);
    // The list-only URL the chips pass through also ends on the article when loaded directly.
    await page.goto(`${path}/list${filtered}`);
    await expect(page).toHaveURL(`${path}${filtered}`);
    await expect(heading(page)).toHaveText("対話のある記事");

    // ← goes back to the inbox with the list's filter.
    await page.getByRole("link", { name: "戻る" }).click();
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(heading(page)).toHaveCount(0);
  });

  test("取得時刻が同じ記事も、一覧・「もっと見る」・次の記事でいつも同じ順に並ぶ", async ({ page }) => {
    const titles = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `同時刻 ${from + i}`);
    const headings = () => list(page).getByRole("heading");

    await openFolder(page, "E2E 同時刻");
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
    await openFolder(page, "E2E 切り替え前");
    await markPage(page);
    await card(page, "切り替え前 1").getByRole("link").click();
    await expect(heading(page)).toHaveText("切り替え前 1");
    // An action before the switch: this used to make every later one reload the page.
    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("切り替え前 2");
    const before = page.url();

    await folderNav(page).getByRole("link", { name: /^E2E 切り替え後\s*\d+$/ }).click();
    await expect(page).not.toHaveURL(before);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+$/);
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

  test("記事の URL を直接開いても 3 ペインで表示され、戻るで前の記事に戻る", async ({ page }) => {
    await openFolder(page, "E2E 直接開く");
    const href = (await card(page, "E2E 直接開く 2").getByRole("link").getAttribute("href"))!;

    await page.goto(href);
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(card(page, "E2E 直接開く 2")).toHaveAttribute("aria-current", "true");
    await expect(folderNav(page).getByRole("link", { name: /^E2E 直接開く/ })).toHaveAttribute("aria-current", "page");
    await expect(chat(page)).toBeVisible();

    await card(page, "E2E 直接開く 3").getByRole("link").click();
    await expect(heading(page)).toHaveText("E2E 直接開く 3");
    await page.goBack();
    await expect(page).toHaveURL(href);
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(card(page, "E2E 直接開く 2")).toHaveAttribute("aria-current", "true");

    await page.reload();
    await expect(heading(page)).toHaveText("E2E 直接開く 2");
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
  });

  test("j / k で移動、e で読了、s でスキップ。入力中は効かない", async ({ page }) => {
    await openFolder(page, "E2E キーボード");
    const filtered = new URL(page.url()).search;
    await expect(page.getByText("一覧から記事を選ぶと、ここで読めます。")).toBeVisible();

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
    await expect(input).toHaveValue("jkes");
    await expect(page).toHaveURL(url);
    await expect(heading(page)).toHaveText("E2E キーボード 2");
    await input.fill("");
    await heading(page).click(); // leaves the input

    await page.keyboard.press("s");
    await expect(heading(page)).toHaveText("E2E キーボード 3");
    await expect(card(page, "E2E キーボード 2")).toHaveCount(0);
    await page.keyboard.press("e");
    // Nothing comes after 3, so the empty state opens beside the list.
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(card(page, "E2E キーボード 3")).toHaveCount(0);
    await expect(card(page, "E2E キーボード 1")).toBeVisible();

    await page.keyboard.press("j");
    await expect(heading(page)).toHaveText("E2E キーボード 1");
    await page.keyboard.press("e");
    await expect(page).toHaveURL(`/${filtered}`);
    await expect(list(page)).toHaveCount(0);

    await page.goto("/read");
    for (const n of [1, 3]) await expect(page.getByText(`E2E キーボード ${n}`)).toBeVisible();
    await expect(page.getByText("E2E キーボード 2")).toHaveCount(0);
  });
});

test.describe("狭い PC 幅", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("対話は右からの引き出しになり、本文が読める幅になる", async ({ page }) => {
    await openFolder(page, "E2E たくさん");
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

test("スマホ幅の記事画面には一覧もヘッダーも出ず、キー操作も効かない @mobile", async ({ page }) => {
  await page.goto("/");
  await card(page, "対話のある記事").getByRole("link").click();
  await expect(heading(page)).toHaveText("対話のある記事");
  const url = page.url();
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reading Room" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "戻る" })).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await page.waitForTimeout(500); // gives a wrongly handled key time to navigate
  await expect(page).toHaveURL(url);
  await expect(heading(page)).toHaveText("対話のある記事");
});
