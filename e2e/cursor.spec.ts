import { expect, test } from "@playwright/test";

const cursor = (el: Element) => getComputedStyle(el).cursor;

test("押せるところにカーソルを合わせると指になる", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ hasText: "本番で動くエージェント" });
  expect(await card.getByRole("link").first().evaluate(cursor)).toBe("pointer");
  expect(await card.getByRole("button", { name: "スキップ" }).evaluate(cursor)).toBe("pointer");

  // A disabled button keeps the arrow.
  const disabled = await page.evaluate(() => {
    const b = document.createElement("button");
    b.disabled = true;
    document.body.append(b);
    return getComputedStyle(b).cursor;
  });
  expect(disabled).toBe("default");
});
