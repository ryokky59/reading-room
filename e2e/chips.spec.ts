import { expect, test, type Locator, type Page } from "@playwright/test";

// The pill behind the folder / site chips. Only reads: uses the filter rows in e2e/seed.mts.

const folderNav = (page: Page) => page.getByRole("navigation", { name: "フォルダ" });
const siteNav = (page: Page) => page.getByRole("navigation", { name: "サイト" });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const chip = (nav: Locator, label: string) =>
  nav.getByRole("link", { name: new RegExp(`^${escape(label)}\\s*\\d*$`) });
const pill = (nav: Locator) => nav.locator(".chip-pill");
const current = (nav: Locator) => nav.locator('a[aria-current="page"]');
const style = (el: Locator, prop: string) =>
  el.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
/** Running CSS transitions on the element (the pill sliding). */
const sliding = (el: Locator) => el.evaluate((e) => e.getAnimations().length);
const ACCENT = "rgb(181, 83, 44)";
const MUTED = "rgb(107, 102, 94)";

/** How far apart two boxes are, in their worst edge. Infinity while either has no box yet, so a poll keeps waiting. */
async function gap(a: Locator, b: Locator) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  if (!x || !y) return Infinity;
  return Math.max(Math.abs(x.x - y.x), Math.abs(x.y - y.y), Math.abs(x.width - y.width), Math.abs(x.height - y.height));
}
/** Waits until the pill sits on `target` (±1px). */
const expectPillOn = (nav: Locator, target: Locator) =>
  expect.poll(() => gap(pill(nav), target)).toBeLessThanOrEqual(1);

/** Prefetches fail and every page answer comes `ms` late, so a pressed chip stays pending. */
async function slowPages(page: Page, ms = 1500) {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (!("rsc" in headers) || "next-action" in headers) return route.fallback();
    if ("next-router-prefetch" in headers) return route.abort();
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback().catch(() => {}); // the router may have moved on
  });
}

test("押したチップへ、一覧が届く前から背景がすべって移り、届いたあともそこに留まる", async ({ page }) => {
  await slowPages(page);
  await page.goto("/");
  const nav = folderNav(page);
  const all = chip(nav, "すべて");
  const business = chip(nav, "Business");
  await expectPillOn(nav, all);
  expect(await sliding(pill(nav))).toBe(0);
  expect(await style(pill(nav), "transition-duration")).toBe("0.3s, 0.3s");
  await expect(all).toHaveCSS("color", ACCENT);
  await expect(business).toHaveCSS("color", MUTED);

  const start = (await pill(nav).boundingBox())!.x;
  await business.click();
  // Moving towards the pressed chip right away, before the list changes.
  await expect.poll(() => sliding(pill(nav))).toBeGreaterThan(0);
  await expect.poll(async () => (await pill(nav).boundingBox())?.x ?? -Infinity).toBeGreaterThan(start);
  await expect(business).toHaveCSS("color", ACCENT);
  await expect(all).toHaveCSS("color", MUTED);
  await expectPillOn(nav, business);
  await expect(all).toHaveAttribute("aria-current", "page");
  expect(page.url()).not.toMatch(/\?f=/);

  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(business).toHaveAttribute("aria-current", "page");
  await expectPillOn(nav, current(nav));
  await expect(business).toHaveCSS("color", ACCENT);
  await expect(all).toHaveCSS("color", MUTED);
});

test("サイトの行は「このフォルダすべて」に背景がある状態で現れ、サイトを押すとそこへすべってフィードの一覧になる", async ({ page }) => {
  await slowPages(page);
  await page.goto("/?a=1");
  await chip(folderNav(page), "Business").click();
  const nav = siteNav(page);
  await expect(nav).toBeVisible();
  // Placed without a slide when the row appears.
  expect(await sliding(pill(nav))).toBe(0);
  expect(await gap(pill(nav), chip(nav, "このフォルダすべて"))).toBeLessThanOrEqual(1);

  const site = chip(nav, "E2E ビジネス週報");
  await site.click();
  await expect.poll(() => sliding(pill(nav))).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/\?f=\d+&s=\d+&a=1$/);
  await expect(page.getByRole("link", { name: "‹ ボード" })).toBeVisible();
});

test("横スクロールする行で画面外のチップが選ばれていても、そのチップと背景が見えている @mobile", async ({ page }) => {
  await page.goto("/");
  const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const last = chip(folderNav(page), "E2E 横スクロール確認用のフォルダ C");
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expect(last).toHaveAttribute("aria-current", "page");
  await expectPillOn(folderNav(page), last);

  // Loaded afresh, the row starts at its left end; the chosen chip is brought into view.
  await page.reload();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(pill(folderNav(page))).toBeInViewport({ ratio: 1 });
  await expectPillOn(folderNav(page), last);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  expect(await pageOverflow()).toBeLessThanOrEqual(0);
});

test("スマホで記事から戻ったとき、背景は左端から伸びずに選択中チップの上にある @mobile", async ({ page }) => {
  await page.goto("/?a=1"); // Keeps the article listed once another test has opened it.
  const nav = folderNav(page);
  const business = chip(nav, "Business");
  await business.click();
  await expect(business).toHaveAttribute("aria-current", "page");
  await expectPillOn(nav, business);

  await page.getByRole("list", { name: "記事" }).getByRole("link").filter({ hasText: "ビジネスの記事" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ビジネスの記事");
  // Notes, every frame from here on, whether the folder row's pill was ever moving.
  await page.evaluate(() => {
    const w = window as unknown as { pillSlid: boolean };
    w.pillSlid = false;
    const watch = () => {
      const p = document.querySelector('nav[aria-label="フォルダ"] .chip-pill');
      if (p && p.getAnimations().length > 0) w.pillSlid = true;
      requestAnimationFrame(watch);
    };
    watch();
  });

  await page.getByRole("link", { name: "戻る", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(business).toBeVisible();
  expect(await sliding(pill(nav))).toBe(0);
  expect(await gap(pill(nav), business)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { pillSlid: boolean }).pillSlid)).toBe(false);
  expect(await gap(pill(nav), business)).toBeLessThanOrEqual(1);
});

test("背景にまだ箱がないあいだ、gap() は投げずに Infinity を返す", async ({ page }) => {
  await page.goto("/");
  const nav = folderNav(page);
  await expectPillOn(nav, chip(nav, "すべて"));
  await pill(nav).evaluate((e) => ((e as HTMLElement).style.display = "none"));
  expect(await pill(nav).boundingBox()).toBeNull();
  expect(await gap(pill(nav), chip(nav, "すべて"))).toBe(Infinity);
  expect(await gap(chip(nav, "すべて"), pill(nav))).toBe(Infinity);
});

test("動きを減らす設定では背景はすべらずに移る", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const nav = folderNav(page);
  expect(await style(pill(nav), "transition-duration")).toBe("0s");
  await chip(nav, "Business").click();
  await expect(page).toHaveURL(/\/\?f=\d+$/);
  await expectPillOn(nav, chip(nav, "Business"));
});

test("ダークモードでも背景は選択中チップの色(accent-soft と accent の枠)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const nav = folderNav(page);
  await expect(pill(nav)).toHaveCSS("background-color", "rgb(58, 42, 33)");
  await expect(pill(nav)).toHaveCSS("border-top-color", "rgb(224, 138, 98)");
  await expect(chip(nav, "すべて")).toHaveCSS("color", "rgb(224, 138, 98)");
});

for (const viewport of [
  { width: 700, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`記事を開いたまま(${viewport.width}px)チップを切り替えても背景が選んだチップに移る`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?a=1"); // Keeps the article listed once another test has opened it.
    await page.getByRole("list", { name: "記事" }).getByRole("link").filter({ hasText: "対話のある記事" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("対話のある記事");

    const nav = folderNav(page);
    await chip(nav, "E2E たくさん").click();
    await expect(page).toHaveURL(/\/articles\/\d+(\/list)?\?f=\d+&a=1$/);
    await expect(chip(nav, "E2E たくさん")).toHaveAttribute("aria-current", "page");
    await expectPillOn(nav, chip(nav, "E2E たくさん"));

    await chip(nav, "すべて").click();
    await expect(chip(nav, "すべて")).toHaveAttribute("aria-current", "page");
    await expectPillOn(nav, chip(nav, "すべて"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("対話のある記事");
  });
}
