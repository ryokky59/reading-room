import { createHash } from "node:crypto";
import { expect, test } from "./test";

// MD5 of the favicon.ico that create-next-app ships (a black "N"); the tab must not show it.
const NEXT_DEFAULT_FAVICON = "2be26fb5639bc7a24d9c816567b0de5f";

test("タブのアイコンが本のアイコンになっている", async ({ page, request }) => {
  const ico = await request.get("/favicon.ico");
  expect(ico.status()).toBe(200);
  const body = await ico.body();
  expect(createHash("md5").update(body).digest("hex")).not.toBe(NEXT_DEFAULT_FAVICON);
  // An ICO header holding the 32px and 48px images.
  expect(body.readUInt16LE(2)).toBe(1);
  expect([body[6], body[22]]).toEqual([32, 48]);

  // The page links the same file, so tabs pick it up.
  await page.goto("/");
  const link = page.locator('link[rel="icon"][href^="/favicon.ico"]');
  await expect(link).toHaveCount(1);
  const linked = await request.get((await link.getAttribute("href"))!);
  expect((await linked.body()).equals(body)).toBe(true);
});
