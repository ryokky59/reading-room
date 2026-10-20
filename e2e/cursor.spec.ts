import { expect, test } from "@playwright/test";

const cursor = (el: Element) => getComputedStyle(el).cursor;

test("押せるところにカーソルを合わせると指になる", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ hasText: "本番で動くエージェント" });
  expect(await card.getByRole("link").first().evaluate(cursor)).toBe("pointer");
  expect(await card.getByRole("button", { name: "スキップ" }).evaluate(cursor)).toBe("pointer");
  expect(await page.getByRole("link", { name: /^すべて/ }).first().evaluate(cursor)).toBe("pointer");

  // The send button is disabled until something is typed, and keeps the arrow until then.
  await card.getByRole("link").first().click();
  const send = page.getByRole("button", { name: "送信" });
  await expect(send).toBeDisabled();
  expect(await send.evaluate(cursor)).toBe("default");
  await page.getByPlaceholder("質問や感想を書く").fill("テスト");
  await expect(send).toBeEnabled();
  expect(await send.evaluate(cursor)).toBe("pointer");
});
