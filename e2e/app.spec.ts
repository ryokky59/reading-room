import { expect, test } from "@playwright/test";

// The seeded data is in e2e/seed.mts. Each test that changes state uses its own article.

test("新着一覧に日本語タイトル・原題・AI 要約・ソースが出る", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ hasText: "本番で動くエージェント" });
  await expect(card).toContainText("Agents in production");
  await expect(card).toContainText("記事 1 の AI 要約です。");
  await expect(card).toContainText("E2E Source");
  await expect(card).toContainText("example.com");
  await expect(card).toContainText("日本語で読める");
  await expect(page.getByRole("listitem").filter({ hasText: "対話のある記事" })).toContainText("対話中");
});

test("一覧からスキップすると消える", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ hasText: "スキップされる記事" });
  await card.getByRole("button", { name: "スキップ" }).click();
  await expect(page.getByText("スキップされる記事")).toHaveCount(0);
});

test("読了にすると読了一覧に移り、未読に戻せる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /読了にする記事/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("読了にする記事");
  await expect(page.getByText("記事 3 の本文です。")).toBeVisible();

  await page.getByRole("button", { name: "読了にする" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("読了にする記事")).toHaveCount(0);

  await page.goto("/read");
  await page.getByRole("link", { name: /読了にする記事/ }).click();
  await page.getByRole("button", { name: "未読に戻す" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("読了にする記事")).toBeVisible();
});

test("保存された対話が記事に表示される", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /対話のある記事/ }).click();
  await expect(page.getByText("この記事の要点は？")).toBeVisible();
  await expect(page.getByText("要点は E2E テストが通ることです。")).toBeVisible();
});

test("フィードを止めて再開できる", async ({ page }) => {
  await page.goto("/feeds");
  const first = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "止める" }) }).first();
  const name = (await first.locator("p").first().textContent())!;
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "止める" }).click();
  await expect(row.getByRole("button", { name: "再開" })).toBeVisible();
  await row.getByRole("button", { name: "再開" }).click();
  await expect(row.getByRole("button", { name: "止める" })).toBeVisible();
});

test("スマホでは対話がシートで開閉する @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /対話のある記事/ }).click();
  const answer = page.getByText("要点は E2E テストが通ることです。");
  await expect(answer).toBeHidden();
  await page.getByRole("button", { name: /対話の続きを開く/ }).click();
  await expect(answer).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(answer).toBeHidden();
});
