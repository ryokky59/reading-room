import { createServer, type Server, type ServerResponse } from "node:http";
import { CRON_SECRET, PICKS_TIMEOUT_MS, PORT } from "./env";
import { expect, resetAfterThis, test, type Page } from "./test";

// 「今朝の 5 本」 at the top of the Board (#102). The seed (e2e/seed.mts) has the same 5 picks for the
// pick day it was made in and the next, all from 「E2E 今朝のサイト」. Each test that opens one opens
// its own row: 1 読了 and back, 2 seen, 3 a failed save, 4 the PC, 5 e2e/activity.spec.ts. The
// test that reads them all puts the seed back after it.

const LABEL = "今朝の 5 本";
const TITLES = ["今朝の 1 本目", "今朝の 2 本目", "今朝の 3 本目", "今朝の 4 本目", "今朝の 5 本目"];
const SITE = "E2E 今朝のサイト";
const reason = (i: number) => `${TITLES[i]}を選んだ理由です。`;

const picks = (page: Page) => page.getByRole("region", { name: LABEL, exact: true });
const pickRows = (page: Page) => picks(page).getByRole("list").getByRole("listitem");
const pickRow = (page: Page, i: number) => pickRows(page).filter({ hasText: TITLES[i] });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const columnRow = (page: Page, title: string) =>
  column(page, SITE).getByRole("list").getByRole("listitem").filter({ hasText: title });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const toast = (page: Page) => page.getByRole("status");
const failed = (page: Page) => page.getByRole("alert").filter({ hasText: "保存できませんでした。もう一度押してください" });
const back = (page: Page) => page.getByRole("link", { name: "戻る", exact: true });
const feedList = (page: Page) => page.getByRole("list", { name: "記事", exact: true });
const overflowsX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** The labels of the Board's first two sections on screen: the picks, then the first folder shown. */
const firstSections = (page: Page) =>
  page.evaluate((label) => {
    const section = document.querySelector(`section[aria-label="${label}"]`)!;
    return [...section.parentElement!.children]
      .filter((el) => el.tagName === "SECTION" && el.getClientRects().length > 0)
      .slice(0, 2)
      .map((el) => el.getAttribute("aria-label"));
  }, LABEL);

/** Where the picks sit against the first folder's section. */
async function picksPlace(page: Page) {
  const [, first] = await firstSections(page);
  const a = (await picks(page).boundingBox())!;
  const b = (await column(page, first!).boundingBox())!;
  return { picks: a, folder: b };
}

test.describe("表示", () => {
  test("スマホ: フォルダのタブの下・最初のフォルダの上に 5 行が、タイトル・サイト名・分数・理由つきで出る @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(picks(page).getByRole("heading", { name: LABEL })).toBeVisible();
    await expect(pickRows(page)).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const row = pickRows(page).nth(i);
      await expect(row).toBeVisible();
      await expect(row).toContainText(TITLES[i]);
      await expect(row).toContainText(SITE);
      await expect(row).toContainText(`${2 * (i + 1)}分`);
      await expect(row).toContainText(reason(i));
    }
    await expect(pickRows(page).nth(1)).toContainText("英→日");
    await expect(pickRows(page).nth(0)).not.toContainText("英→日");

    expect((await firstSections(page))[0]).toBe(LABEL);
    const nav = (await page.getByRole("navigation", { name: "フォルダ" }).boundingBox())!;
    const { picks: box, folder } = await picksPlace(page);
    expect(box.y).toBeGreaterThan(nav.y + nav.height);
    expect(box.y + box.height).toBeLessThanOrEqual(folder.y);
    expect(await overflowsX(page)).toBe(false);

    // The picked articles stay in their own column too.
    for (const title of TITLES.slice(0, 3)) await expect(columnRow(page, title)).toBeAttached();
  });

  test("スマホ: 1 行目から開いて読了するとボードに戻って 4 行、見出しは 5 本のまま。「元に戻す」で 5 行に戻る @mobile", async ({ page }) => {
    await page.goto("/");
    await pickRow(page, 0).getByRole("link").click();
    await expect(heading(page)).toHaveText(TITLES[0]);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);

    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(page).toHaveURL("/");
    await expect(heading(page)).toHaveCount(0);
    await expect(pickRows(page)).toHaveCount(4);
    await expect(pickRow(page, 0)).toHaveCount(0);
    await expect(picks(page).getByRole("heading", { name: LABEL })).toBeVisible();
    await expect(toast(page).getByText("読了にしました")).toBeVisible();

    await toast(page).getByRole("button", { name: "元に戻す" }).click();
    await expect(pickRows(page)).toHaveCount(5);
    await expect(pickRows(page).first()).toContainText(TITLES[0]);
    // Back as it was: seen, since it was opened.
    await expect(pickRow(page, 0)).toHaveAttribute("data-seen", "");
    await expect(columnRow(page, TITLES[0])).toBeAttached();
  });

  test("スマホ: 2 行目を開いてブラウザの戻るで戻ると薄く残り、読み込み直しても薄く残る @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(pickRow(page, 1)).not.toHaveAttribute("data-seen", "");
    await pickRow(page, 1).getByRole("link").click();
    await expect(heading(page)).toHaveText(TITLES[1]);
    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect(pickRow(page, 1)).toHaveAttribute("data-seen", "");
    await expect(pickRows(page)).toHaveCount(5);

    await page.reload();
    await expect(pickRows(page)).toHaveCount(5);
    await expect(pickRow(page, 1)).toHaveAttribute("data-seen", "");
  });

  test("スマホ: ピックから開いた記事の読了が保存できないと記事の上にメッセージが出て、ボードに戻ると行は残る @mobile", async ({ page }) => {
    await page.goto("/");
    await pickRow(page, 2).getByRole("link").click();
    await expect(heading(page)).toHaveText(TITLES[2]);
    await page.route("**/*", (route) => ("next-action" in route.request().headers() ? route.abort() : route.fallback()));

    await page.getByRole("button", { name: "読了にする" }).click();
    await expect(failed(page)).toBeVisible();
    await expect(heading(page)).toHaveText(TITLES[2]);
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);

    await page.unrouteAll();
    await back(page).click();
    await expect(page).toHaveURL("/");
    await expect(pickRows(page)).toHaveCount(5);
    await expect(pickRow(page, 2)).toBeVisible();
  });

  test("スマホ: スキップでも行がなくなり、5 行とも読了・スキップすると「今朝の 5 本は読み終えました」が出る @mobile", async ({ page }, testInfo) => {
    await page.goto("/");
    for (let i = 0; i < 5; i++) {
      const skip = i % 2 === 1;
      await pickRow(page, i).getByRole("link").click();
      await expect(heading(page)).toHaveText(TITLES[i]);
      if (skip) await page.getByRole("button", { name: "スキップ", exact: true }).click();
      else await page.getByRole("button", { name: "読了にする" }).click();
      await expect(page).toHaveURL("/");
      await expect(toast(page).getByText(skip ? "スキップしました" : "読了にしました")).toBeVisible();
      await expect(pickRow(page, i)).toHaveCount(0);
      if (i < 4) await expect(pickRows(page)).toHaveCount(4 - i);
    }
    await expect(picks(page).getByRole("heading", { name: LABEL })).toBeVisible();
    await expect(picks(page)).toContainText("今朝の 5 本は読み終えました");
    await expect(picks(page).getByRole("listitem")).toHaveCount(0);

    // It stays on a full load, until the next pick day.
    await page.reload();
    await expect(picks(page)).toContainText("今朝の 5 本は読み終えました");
    resetAfterThis(testInfo.titlePath.join(" > "));
  });

  test("PC 1280×720: 左端の列として出て、行を押すと記事が開く(列の行から開いたときと同じシート)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(picks(page)).toBeVisible();
    expect((await firstSections(page))[0]).toBe(LABEL);
    const { picks: box, folder } = await picksPlace(page);
    expect(box.width).toBe(260);
    expect(box.x + box.width).toBeLessThan(folder.x);
    expect(Math.abs(box.y - folder.y)).toBeLessThanOrEqual(1);
    await expect(pickRows(page)).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(pickRows(page).nth(i)).toBeVisible();

    await pickRow(page, 3).getByRole("link").click();
    await expect(heading(page)).toHaveText(TITLES[3]);
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
    // From `lg` up an article opened from the Board is a sheet over it, from a column row too.
    await expect(page.getByRole("button", { name: "記事を閉じる" })).toBeVisible();
    await expect(picks(page)).toBeVisible();
  });

  test("PC 1000×800: 開いた記事の横に、その記事のフィードの一覧が出る", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/");
    // Row 4 again: the PC test above opened it, and opening it once more changes nothing.
    await pickRow(page, 3).getByRole("link").click();
    await expect(heading(page)).toHaveText(TITLES[3]);
    // The feed's list, as from its column: the open article's card, and only the feed's articles.
    const cards = feedList(page).getByRole("listitem");
    await expect(cards.filter({ hasText: TITLES[3] })).toBeVisible();
    await expect(cards.filter({ hasNotText: "今朝の" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: SITE, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/articles\/\d+\?f=\d+&s=\d+$/);
  });

  for (const [name, viewport, columns] of [
    ["横向きの iPhone 852×393", { width: 852, height: 393 }, false],
    ["展開した iPhone Duo 相当 669×825", { width: 669, height: 825 }, true],
  ] as const) {
    test(`${name}: ${columns ? "左端の列" : "縦積みの最初のセクション"}として出る`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(pickRows(page)).toHaveCount(5);
      expect((await firstSections(page))[0]).toBe(LABEL);
      const { picks: box, folder } = await picksPlace(page);
      if (columns) {
        expect(box.width).toBe(260);
        expect(box.x + box.width).toBeLessThan(folder.x);
        expect(Math.abs(box.y - folder.y)).toBeLessThanOrEqual(1);
      } else {
        expect(box.y + box.height).toBeLessThanOrEqual(folder.y);
        expect(Math.abs(box.x - folder.x)).toBeLessThanOrEqual(1);
        await pickRows(page).nth(4).scrollIntoViewIfNeeded();
        await expect(pickRows(page).nth(4)).toBeVisible();
      }
      expect(await overflowsX(page)).toBe(false);
    });
  }

  test("フォルダのタブを選ぶと出ない", async ({ page }) => {
    await page.goto("/");
    await expect(picks(page)).toBeVisible();
    await page
      .getByRole("navigation", { name: "フォルダ" })
      .getByRole("link", { name: /^E2E 今朝のフォルダ\s*\d+$/ })
      .click();
    await expect(page).toHaveURL(/\/\?f=\d+$/);
    await expect(column(page, SITE)).toBeVisible();
    await expect(picks(page)).toHaveCount(0);
    await expect(page.getByText("読み終えました")).toHaveCount(0);
  });
});

test.describe("選ぶ(/api/cron)", () => {
  let api: Server;
  // The bodies of the picks calls the stub received, and its next answers, oldest first.
  const calls: string[] = [];
  // An answer is given the candidate ids of the call, by title.
  type Reply = (res: ServerResponse, ids: Record<string, number>) => void;
  const replies: Reply[] = [];
  const auth = { authorization: `Bearer ${CRON_SECRET}` };
  const onlyPicks = (day: string) => `/api/cron?only=picks&day=${day}`;

  const sse = (stopReason: string, text?: string) =>
    [
      {
        type: "message_start",
        message: {
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: "e2e",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      ...(text === undefined
        ? []
        : [
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
            { type: "content_block_stop", index: 0 },
          ]),
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
  const send = (res: ServerResponse, picks: { id: number; reason: string }[]) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse("end_turn", JSON.stringify({ picks })));
  };
  const answer = (picks: (ids: Record<string, number>) => { id: number; reason: string }[]) =>
    replies.push((res, ids) => send(res, picks(ids)));
  const refuse = () => replies.push((res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse("refusal"));
  });
  // 400 rather than 500: the SDK does not retry it.
  const error: Reply = (res) => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "e2e" } }));
  };

  // Never answers: the request is read and left open (#152).
  const hang: Reply = () => {};
  // Sends the headers and the first event, then goes quiet with the stream open.
  const quiet: Reply = (res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(sse("end_turn").split("\n\n")[0] + "\n\n");
  };

  // Calls left unanswered for the test to answer, in the order they came (#153).
  const held: { res: ServerResponse; ids: Record<string, number> }[] = [];
  const hold: Reply = (res, ids) => {
    held.push({ res, ids });
  };

  /** The candidate ids in a picks call, by title. */
  const idsIn = (body: string) =>
    Object.fromEntries([...body.matchAll(/<article id=\\?"(\d+)\\?"><title>(.*?)<\/title>/g)].map((m) => [m[2], Number(m[1])]));

  test.beforeAll(async () => {
    api = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        // A digest that a full run of the cron tries fails, as everywhere outside digest.spec.ts.
        if (!raw.includes("<candidates>")) return error(res, {});
        calls.push(raw);
        (replies.shift() ?? error)(res, idsIn(raw));
      });
    });
    await new Promise<void>((resolve, reject) => {
      api.once("error", reject); // A taken port would silently send the app's calls elsewhere.
      api.listen(PORT + 1000, "127.0.0.1", resolve);
    });
  });

  test.afterAll(async () => {
    // close() waits for open connections, and a stream left quiet never ends by itself.
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });

  test.beforeEach(() => {
    calls.length = 0;
    replies.length = 0;
    held.length = 0;
  });

  test("行のない日に叩くと AI を 1 回呼んで、返した順に保存して返す。同じ日にもう一度叩くと呼ばずに同じ行を返す", async ({ page }) => {
    let ids: Record<string, number> = {};
    answer((given) => {
      ids = given;
      return [
        { id: given["選ぶ候補 B"], reason: "B を選んだ理由" },
        { id: given["選ぶ候補 A"], reason: "A を選んだ理由" },
      ];
    });
    const res = await page.request.get(onlyPicks("2001-01-01"), { headers: auth });
    expect(res.status()).toBe(200);
    expect(calls).toHaveLength(1);
    expect(ids["選ぶ候補 A"]).toBeGreaterThan(0);
    expect(ids["選ぶ候補 B"]).toBeGreaterThan(0);
    expect(calls[0]).toContain("選ぶ候補 Aの要約です。");
    expect(calls[0]).toContain("選ぶ候補 Bの要約です。");
    expect(calls[0]).toContain("E2E ピック候補のサイト");
    // Candidates only: these are older than a day.
    expect(calls[0]).not.toContain("今朝の 1 本目");
    const expected = [
      { day: "2001-01-01", position: 0, articleId: ids["選ぶ候補 B"], reason: "B を選んだ理由" },
      { day: "2001-01-01", position: 1, articleId: ids["選ぶ候補 A"], reason: "A を選んだ理由" },
    ];
    expect(await res.json()).toEqual({ picks: expected });

    const again = await page.request.get(onlyPicks("2001-01-01"), { headers: auth });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ picks: expected });
    expect(calls).toHaveLength(1);
  });

  test("候補にない id と 2 回目の同じ id は保存せず、エラーや拒否では何も保存せず次にまた呼ぶ", async ({ page }) => {
    // An error, then a refusal: nothing is saved, and each call asks again.
    replies.push(error);
    refuse();
    expect((await page.request.get(onlyPicks("2001-01-02"), { headers: auth })).status()).toBe(500);
    expect((await page.request.get(onlyPicks("2001-01-02"), { headers: auth })).status()).toBe(500);
    expect(calls).toHaveLength(2);

    // Only unknown ids: nothing to save either.
    answer(() => [{ id: 999_999, reason: "候補にない" }]);
    const none = await page.request.get(onlyPicks("2001-01-02"), { headers: auth });
    expect(await none.json()).toEqual({ picks: [] });
    expect(calls).toHaveLength(3);

    answer((ids) => [
      { id: 999_999, reason: "候補にない" },
      { id: ids["選ぶ候補 A"], reason: "A の理由" },
      { id: ids["選ぶ候補 A"], reason: "A の理由 2 回目" },
      { id: ids["選ぶ候補 B"], reason: "B の理由" },
    ]);
    const res = await page.request.get(onlyPicks("2001-01-02"), { headers: auth });
    const ids = idsIn(calls[3]);
    expect(calls).toHaveLength(4);
    expect(await res.json()).toEqual({
      picks: [
        { day: "2001-01-02", position: 0, articleId: ids["選ぶ候補 A"], reason: "A の理由" },
        { day: "2001-01-02", position: 1, articleId: ids["選ぶ候補 B"], reason: "B の理由" },
      ],
    });
  });

  test("CRON_SECRET がない・違うと 401", async ({ page }) => {
    for (const url of ["/api/cron", onlyPicks("2001-01-03")]) {
      expect((await page.request.get(url)).status()).toBe(401);
      expect((await page.request.get(url, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
      expect((await page.request.get(url, { headers: { authorization: CRON_SECRET } })).status()).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  test("ピックが失敗しても /api/cron は取得の結果を 200 で返す", async ({ page }) => {
    test.setTimeout(120_000);
    const res = await page.request.get("/api/cron?day=2001-01-04", { headers: auth, timeout: 100_000 });
    expect(res.status()).toBe(200);
    expect(calls).toHaveLength(1);
    const body = await res.json();
    expect(typeof body.added).toBe("number");
    expect(Array.isArray(body.failedFeeds)).toBe(true);
    // The seed's feed on a closed port.
    expect(body.failedFeeds).toContain("E2E 列 エラー");
  });

  test("AI が応答を返さないと、上限でピックをあきらめて 500。何も保存せず、同じ日にまた呼ぶ", async ({ page }) => {
    replies.push(hang, hang);
    // Without the limit the call would wait as long as the stub, so the request times out.
    const timeout = PICKS_TIMEOUT_MS + 10_000;
    expect((await page.request.get(onlyPicks("2001-01-05"), { headers: auth, timeout })).status()).toBe(500);
    expect(calls).toHaveLength(1);
    expect((await page.request.get(onlyPicks("2001-01-05"), { headers: auth, timeout })).status()).toBe(500);
    expect(calls).toHaveLength(2);
  });

  test("AI がヘッダーと message_start だけ返して黙っても、/api/cron は上限のあと取得に進み、結果を 200 で返す", async ({ page }) => {
    test.setTimeout(120_000);
    replies.push(quiet);
    const started = Date.now();
    // The rest of the run, the fetch against the seed, takes well under a second (0.1–0.4 s for the
    // test above, locally and in CI), so 15 s more is room for a slow runner. Without the limit the
    // request runs into its own timeout.
    const res = await page.request.get("/api/cron?day=2001-01-06", { headers: auth, timeout: PICKS_TIMEOUT_MS + 15_000 });
    const took = Date.now() - started;
    expect(res.status()).toBe(200);
    expect(calls).toHaveLength(1);
    const body = await res.json();
    expect(typeof body.added).toBe("number");
    expect(Array.isArray(body.failedFeeds)).toBe(true);
    expect(took).toBeGreaterThanOrEqual(PICKS_TIMEOUT_MS);
    expect(took).toBeLessThan(PICKS_TIMEOUT_MS + 15_000);
  });

  test("同じ日に 2 つ同時に叩くと、先に保存した 1 回分だけが残る。後の回は何も足さず、同じ行を返す", async ({ page }) => {
    // Both runs find the day empty and ask the AI. The stub holds both calls, answers the first with
    // one pick, and answers the second, with two, only after the first request has returned: so the
    // second saves after the first, whatever the speed of the machine.
    replies.push(hold, hold);
    const day = "2001-01-07";
    const one = page.request.get(onlyPicks(day), { headers: auth });
    const two = page.request.get(onlyPicks(day), { headers: auth });
    await expect.poll(() => held.length).toBe(2);

    const a = held[0].ids["選ぶ候補 A"];
    const b = held[1].ids["選ぶ候補 B"];
    expect(a).toBeGreaterThan(0);
    expect(held[1].ids["選ぶ候補 A"]).toBe(a);
    send(held[0].res, [{ id: a, reason: "1 回目の A" }]);
    // The other request cannot return before its call is answered, so the first to return is the one
    // answered.
    const [firstRes, other] = await Promise.race([
      one.then((r) => [r, two] as const),
      two.then((r) => [r, one] as const),
    ]);
    const expected = { picks: [{ day, position: 0, articleId: a, reason: "1 回目の A" }] };
    expect(firstRes.status()).toBe(200);
    expect(await firstRes.json()).toEqual(expected);

    send(held[1].res, [
      { id: b, reason: "2 回目の B" },
      { id: a, reason: "2 回目の A" },
    ]);
    const secondRes = await other;
    expect(secondRes.status()).toBe(200);
    expect(await secondRes.json()).toEqual(expected);

    const again = await page.request.get(onlyPicks(day), { headers: auth });
    expect(await again.json()).toEqual(expected);
    expect(calls).toHaveLength(2);
  });
});
