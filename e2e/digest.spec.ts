import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "./test";
import { DIGEST_RETRY_INTERVAL_MS as INTERVAL } from "./env";
import { openFeed } from "./nav";

// AI digests and translations that fail. The Anthropic API is played by a stub on the port
// playwright.config.ts points the app at, and the feed by a second local server, so nothing
// reaches the outside network.

const FAILED = "AI 要約できませんでした";
const LIMIT = 5;
const SEEDED = "要約を断られた記事";
const SEEDED_MOBILE = "スマホで開く断られた記事";
const BODY = "要約テストの本文です。"; // Also what the card shows as the excerpt.
const TRANSLATION_FAILED = "(日本語にまとめられませんでした。やり直してください)";
const TRANSLATION_CUT = "(記事が長く、ここまでで切れました。やり直してください)";
const REVIEW_FAILED = "(この月の振り返りは作れませんでした。作り直してください)";
const REVIEW_CUT = "(振り返りが長くなり、ここまでで切れました。作り直してください)";
// The widths the owner reads on: a phone upright and on its side, and a PC.
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/**
 * How far the characters of `text` reach past the right edge of the nearest ancestor that
 * clips or scrolls sideways (the article pane from 600px up), or of the window when there is
 * none. The element's own box does not grow when its characters overflow, so the characters
 * are measured through a Range.
 */
const textOverflow = (page: Page, text: string) =>
  page.getByText(text).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const right = Math.max(...Array.from(range.getClientRects(), (r) => r.right));
    let frame = el.parentElement;
    while (frame && getComputedStyle(frame).overflowX === "visible") frame = frame.parentElement;
    const edge = frame ? frame.getBoundingClientRect().left + frame.clientLeft + frame.clientWidth : window.innerWidth;
    return right - edge;
  });

/**
 * Checks at each width that `text` is shown, nothing makes the page scroll sideways, and the
 * text's characters stay inside the pane it scrolls in. With `control`, it also checks at the
 * widths where the article has its own pane that a line kept from wrapping is caught, though
 * the page itself does not scroll sideways.
 */
async function expectFits(page: Page, text: string, { control = false } = {}) {
  const size = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    const at = `${viewport.width}×${viewport.height}`;
    await page.setViewportSize(viewport);
    await expect(page.getByText(text)).toBeVisible();
    expect(await pageOverflow(page), at).toBeLessThanOrEqual(0);
    // 1px for fractional widths.
    expect(await textOverflow(page, text), at).toBeLessThanOrEqual(1);
    if (control && viewport.width >= 600) {
      const element = page.getByText(text);
      await element.evaluate((el) => {
        el.style.whiteSpace = "nowrap";
        el.style.paddingLeft = "4000px";
      });
      expect(await textOverflow(page, text), `${at}, kept from wrapping`).toBeGreaterThan(1);
      expect(await pageOverflow(page), `${at}, kept from wrapping`).toBeLessThanOrEqual(0);
      await element.evaluate((el) => {
        el.style.whiteSpace = "";
        el.style.paddingLeft = "";
      });
    }
  }
  if (size) await page.setViewportSize(size);
}

const cards = (page: Page) => page.getByRole("list", { name: "記事" }).getByRole("listitem");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });

const sse = (stopReason: string, text?: string) => {
  const events: Record<string, unknown>[] = [
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
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
};

test.describe("要約と翻訳の失敗", () => {
  let api: Server;
  let site: Server;
  let origin: string;
  // Calls the stub received, by the fixture title found in the request.
  const calls = {
    digest: {} as Record<string, number>,
    translate: {} as Record<string, number>,
    review: {} as Record<string, number>,
  };
  // The stub's next look-back replies, oldest first.
  const reviewReplies: string[] = [];
  // When the stub last received a digest call, by title.
  const lastDigest: Record<string, number> = {};
  const titles = ["上限テストの記事", "拒否テストの記事", "成功テストの記事", "Translation refusal test", "Translation cut-off test", SEEDED, SEEDED_MOBILE];
  // Each test has its own feed, empty while it is added, so its articles come in through 「今すぐ取得」.
  const listed: Record<string, string[]> = { "/limit.xml": [], "/other.xml": [], "/refused.xml": [], "/translate.xml": [], "/cut.xml": [] };

  /**
   * Presses 「今すぐ取得」, waits for the run to end, and opens `feed`'s list freshly loaded: the
   * Board shows titles only, and the failure is on the list's cards.
   */
  async function fetchOnce(page: Page, feed: string) {
    await pressFetch(page);
    await openList(page, feed);
  }

  async function pressFetch(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "今すぐ取得" }).click();
    await expect(page.getByText(/本の新着を追加しました/)).toBeVisible({ timeout: 60_000 });
  }

  async function openList(page: Page, feed: string) {
    await page.goto("/");
    await page.getByRole("region", { name: feed, exact: true }).getByRole("heading", { level: 3 }).getByRole("link").click();
    await expect(page).toHaveURL(/\/\?(f=\d+&)?s=\d+(&a=1)?$/);
  }

  async function addFeed(page: Page, path: string, name: string) {
    await page.goto("/feeds");
    await page.getByLabel("サイトを追加").fill(`${origin}${path}`);
    await page.getByPlaceholder("表示名(空ならサイト名を使います)").fill(name);
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByText(`「${name}」を追加し、0 本を取り込みました`)).toBeVisible({ timeout: 60_000 });
  }

  test.beforeAll(async () => {
    api = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as { output_config?: { format?: unknown } };
        // The look-back lists every article read that month, so it is told apart before the titles.
        const kind = raw.includes("振り返りを書いてください")
          ? "review"
          : body.output_config?.format
            ? "digest"
            : "translate";
        const title = kind === "review" ? "(month)" : (titles.find((t) => raw.includes(t)) ?? "(other)");
        const n = (calls[kind][title] = (calls[kind][title] ?? 0) + 1);
        if (kind === "digest") lastDigest[title] = Date.now();
        const stream = (events: string) => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(events);
        };
        const digest = (lang: string, titleJa: string) =>
          stream(sse("end_turn", JSON.stringify({ lang, title_ja: titleJa, summary: `${titleJa}の要約です。` })));
        if (kind === "review") {
          // A test that queues its own replies does not depend on the calls earlier tests made;
          // otherwise refused first, then ended with nothing written.
          const reply = reviewReplies.shift();
          stream(reply ?? (n === 1 ? sse("refusal") : sse("end_turn")));
        } else if (kind === "translate" && title === "Translation cut-off test") {
          // Empty, then cut off by the length limit twice (the reload in between), then complete.
          if (n === 1) stream(sse("end_turn"));
          else if (n <= 3) stream(sse("max_tokens", `## 前半\n\n途中までの翻訳です(${n} 回目)。`));
          else stream(sse("end_turn", "最後まで翻訳できました。"));
        } else if (kind === "translate") {
          stream(n === 1 ? sse("refusal") : sse("end_turn", "二度目の翻訳は成功しました。"));
        } else if (title === "上限テストの記事" && n % 2 === 0) {
          // Every other try comes back with an empty summary, which counts as a failure like a 400.
          stream(sse("end_turn", JSON.stringify({ lang: "ja", title_ja: "上限テストの記事", summary: "" })));
        } else if (title === "拒否テストの記事") {
          stream(sse("refusal"));
        } else if (title === "成功テストの記事") {
          digest("ja", "成功テストの記事");
        } else if (title === "Translation refusal test") {
          digest("other", "翻訳を断られる記事");
        } else if (title === "Translation cut-off test") {
          digest("other", "翻訳が切れる記事");
        } else {
          // 400 rather than 500: the SDK does not retry it, so the test stays quick.
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "e2e" } }));
        }
      });
    });
    const apiPort = Number(process.env.E2E_PORT ?? 3210) + 1000;
    await new Promise<void>((resolve, reject) => {
      api.once("error", reject); // A taken port would silently send the app's calls elsewhere.
      api.listen(apiPort, "127.0.0.1", resolve);
    });

    site = createServer((req, res) => {
      if (req.url && req.url in listed) {
        const now = new Date().toUTCString();
        const items = listed[req.url].map(
          (t, i) => `<item><title>${t}</title><link>${origin}/posts${req.url}/${i}</link><pubDate>${now}</pubDate></item>`,
        );
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>要約テスト</title><link>${origin}/</link>${items.join("")}</channel></rss>`);
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><head><title>記事</title></head><body><article><h1>記事</h1>${`<p>${BODY}段落をいくつか並べています。</p>`.repeat(8)}</article></body></html>`,
        );
      }
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => api.close(resolve));
    await new Promise((resolve) => site.close(resolve));
  });

  // Opening an article marks it seen, so each screen opens its own seeded article.
  for (const [screen, tag, title, n] of [
    ["PC", "", SEEDED, 10],
    ["スマホ", " @mobile", SEEDED_MOBILE, 11],
  ] as const) {
    test(`要約を断られた記事のカードに失敗と概要が出て、バッジは出ず、記事は読める(${screen})${tag}`, async ({ page }) => {
      await openFeed(page, "E2E 要約できない");
      const seeded = card(page, title);
      await expect(seeded).toContainText(FAILED);
      await expect(seeded).toContainText(`${title}の RSS の概要です。`);
      await expect(seeded.getByText("AI 要約", { exact: true })).toHaveCount(0);

      await seeded.getByRole("link").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("main")).toContainText(`記事 ${n} の本文です。`);
      await expect(page.getByRole("link", { name: /元記事を開く/ }).first()).toHaveAttribute(
        "href",
        `https://example.com/e2e/${n}`,
      );
    });
  }

  test("失敗し続ける記事(400 と空の要約)は間隔を空けて上限の回数まで試し、間隔内の取得やサイトの追加では試さない", async ({ page }) => {
    test.setTimeout(300_000);
    await addFeed(page, "/limit.xml", "上限テスト");
    listed["/limit.xml"].push("上限テストの記事", "成功テストの記事");
    const failing = card(page, "上限テストの記事");
    // A success needs no second try and shows the badge and the Japanese title as before.
    const expectSuccessOnce = async () => {
      expect(calls.digest["成功テストの記事"]).toBe(1);
      await expect(card(page, "成功テストの記事")).toContainText("成功テストの記事の要約です。");
      await expect(card(page, "成功テストの記事").getByText("AI 要約", { exact: true })).toBeVisible();
    };
    // Waits until the last try is more than the interval ago.
    const waitInterval = async () => {
      const wait = lastDigest["上限テストの記事"] + INTERVAL + 1_500 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    };

    // The first try is when the article is saved.
    await fetchOnce(page, "上限テスト");
    expect(calls.digest["上限テストの記事"]).toBe(1);
    await expect(failing).toContainText(BODY);
    await expect(failing).not.toContainText(FAILED);
    await expectSuccessOnce();

    // Within the interval, neither another 「今すぐ取得」 nor adding a site tries it again.
    const firstTry = lastDigest["上限テストの記事"];
    await pressFetch(page);
    await addFeed(page, "/other.xml", "間隔テスト");
    expect(Date.now() - firstTry, "both ran within the interval").toBeLessThan(INTERVAL);
    expect(calls.digest["上限テストの記事"]).toBe(1);
    await openList(page, "上限テスト");
    await expect(failing).toContainText(BODY);
    await expect(failing).not.toContainText(FAILED);

    // Each fetch after the interval tries once more, and the last try shows the failure.
    for (let run = 2; run <= LIMIT; run++) {
      await waitInterval();
      await fetchOnce(page, "上限テスト");
      expect(calls.digest["上限テストの記事"]).toBe(run);
      await expect(failing).toContainText(BODY);
      if (run < LIMIT) await expect(failing).not.toContainText(FAILED);
      else await expect(failing).toContainText(FAILED);
      await expectSuccessOnce();
    }

    // After the limit it is not tried again, even once the interval has passed.
    await waitInterval();
    await fetchOnce(page, "上限テスト");
    expect(calls.digest["上限テストの記事"]).toBe(LIMIT);
    await expect(failing).toContainText(FAILED);
    expect(calls.digest[SEEDED]).toBeUndefined();
    expect(calls.digest[SEEDED_MOBILE]).toBeUndefined();
  });

  test("要約を拒否された記事は 1 回で諦めてカードに出て、それ以降は要約を呼ばない", async ({ page }) => {
    test.setTimeout(90_000);
    await addFeed(page, "/refused.xml", "拒否テスト");
    listed["/refused.xml"].push("拒否テストの記事");
    await fetchOnce(page, "拒否テスト");
    expect(calls.digest["拒否テストの記事"]).toBe(1);
    await expect(card(page, "拒否テストの記事")).toContainText(FAILED);
    await expect(card(page, "拒否テストの記事")).toContainText(BODY);

    await fetchOnce(page, "拒否テスト");
    expect(calls.digest["拒否テストの記事"]).toBe(1);
  });

  test("翻訳を拒否されると失敗の文と「やり直す」が出て、やり直せる", async ({ page }) => {
    test.setTimeout(90_000);
    await addFeed(page, "/translate.xml", "翻訳テスト");
    listed["/translate.xml"].push("Translation refusal test");
    await fetchOnce(page, "翻訳テスト");
    await card(page, "翻訳を断られる記事").getByRole("link").first().click();

    await expect(page.getByRole("main")).toContainText(TRANSLATION_FAILED);
    const retry = page.getByRole("button", { name: "やり直す" });
    await expect(retry).toBeVisible();

    await retry.click();
    await expect(page.getByRole("main")).toContainText("二度目の翻訳は成功しました。");
    await expect(page.getByRole("main")).not.toContainText(TRANSLATION_FAILED);
    await expect(retry).toHaveCount(0);
    expect(calls.translate["Translation refusal test"]).toBe(2);
  });

  test("翻訳が空で返ると失敗の文、途中で切れると切れた旨の文と「やり直す」が出て、切れた翻訳は保存されない", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await addFeed(page, "/cut.xml", "翻訳切れテスト");
    listed["/cut.xml"].push("Translation cut-off test");
    await fetchOnce(page, "翻訳切れテスト");
    await card(page, "翻訳が切れる記事").getByRole("link").first().click();
    const main = page.getByRole("main");
    const retry = page.getByRole("button", { name: "やり直す" });

    // Empty: the failure and 「やり直す」.
    await expect(main).toContainText(TRANSLATION_FAILED);
    await expect(retry).toBeVisible();
    expect(calls.translate["Translation cut-off test"]).toBe(1);
    await expectFits(page, TRANSLATION_FAILED, { control: true });

    // Cut off: what came, then the note under it, and 「やり直す」.
    await retry.click();
    await expect(main).toContainText("途中までの翻訳です(2 回目)。");
    await expect(main).toContainText(TRANSLATION_CUT);
    await expect(main).not.toContainText(TRANSLATION_FAILED);
    await expect(retry).toBeVisible();
    expect(calls.translate["Translation cut-off test"]).toBe(2);
    const partial = await main.getByText("途中までの翻訳です(2 回目)。").boundingBox();
    const note = await main.getByText(TRANSLATION_CUT).boundingBox();
    expect(note!.y).toBeGreaterThan(partial!.y);
    await expectFits(page, TRANSLATION_CUT);

    // The cut-off translation was not kept, so opening the article again translates it again.
    await page.reload();
    await expect(main).toContainText("途中までの翻訳です(3 回目)。");
    await expect(main).toContainText(TRANSLATION_CUT);
    expect(calls.translate["Translation cut-off test"]).toBe(3);

    // A complete one clears the note and 「やり直す」, and is kept.
    await retry.click();
    await expect(main).toContainText("最後まで翻訳できました。");
    await expect(main).not.toContainText(TRANSLATION_CUT);
    await expect(retry).toHaveCount(0);
    expect(calls.translate["Translation cut-off test"]).toBe(4);
    await page.reload();
    await expect(main).toContainText("最後まで翻訳できました。");
    expect(calls.translate["Translation cut-off test"]).toBe(4);
  });

  test("振り返りが拒否されたり空で終わったりすると失敗の文が出て、作り直せて、保存されない", async ({ page }) => {
    // The seed has articles read this month, and its section comes first.
    await page.goto("/read");
    const month = page.getByRole("main").locator("section").first();
    await month.getByRole("button", { name: "この月を振り返る" }).click();

    // Refused: the failure instead of 「考えています…」, and 「作り直す」.
    await expect(month).toContainText(REVIEW_FAILED);
    await expect(month.getByText("考えています…")).toHaveCount(0);
    const again = month.getByRole("button", { name: "作り直す" });
    await expect(again).toBeVisible();
    expect(calls.review["(month)"]).toBe(1);
    await expectFits(page, REVIEW_FAILED);

    // Ended with nothing written: the same.
    await again.click();
    await expect.poll(() => calls.review["(month)"]).toBe(2);
    await expect(again).toBeVisible();
    await expect(month).toContainText(REVIEW_FAILED);
    await expect(month.getByText("考えています…")).toHaveCount(0);

    // Nothing was kept for the month.
    await page.reload();
    await expect(month.getByRole("button", { name: "この月を振り返る" })).toBeVisible();
    await expect(month.getByRole("button", { name: "振り返りを見る" })).toHaveCount(0);
    await expect(month).not.toContainText(REVIEW_FAILED);
  });

  test("振り返りが長さの上限で切れると切れた旨の文が出て保存されず、最後まで書けた振り返りも上書きしない", async ({
    page,
  }) => {
    const PARTIAL = "途中までの振り返りです。";
    const COMPLETE = "最後まで書けた振り返りです。";
    const PARTIAL_AGAIN = "二度目は切れた振り返りです。";
    reviewReplies.splice(
      0,
      reviewReplies.length,
      sse("max_tokens", PARTIAL),
      sse("max_tokens", PARTIAL),
      sse("end_turn", COMPLETE),
      sse("max_tokens", PARTIAL_AGAIN),
    );
    const before = calls.review["(month)"] ?? 0;
    // The seed has articles read this month, and its section comes first.
    await page.goto("/read");
    const month = page.getByRole("main").locator("section").first();
    const start = month.getByRole("button", { name: "この月を振り返る" });
    const again = month.getByRole("button", { name: "作り直す" });
    const view = month.getByRole("button", { name: "振り返りを見る" });

    // Cut off: what came, the note under it, no 「考えています…」, and 「作り直す」.
    await start.click();
    await expect(month).toContainText(REVIEW_CUT);
    await expect(month).toContainText(PARTIAL);
    await expect(month).not.toContainText(REVIEW_FAILED);
    await expect(month.getByText("考えています…")).toHaveCount(0);
    await expect(again).toBeVisible();
    const partial = await month.getByText(PARTIAL).boundingBox();
    const note = await month.getByText(REVIEW_CUT).boundingBox();
    expect(note!.y).toBeGreaterThan(partial!.y);
    await expectFits(page, REVIEW_CUT);

    // It was not kept.
    await page.reload();
    await expect(start).toBeVisible();
    await expect(view).toHaveCount(0);
    await expect(month).not.toContainText(PARTIAL);

    // Cut off again, then complete through 「作り直す」: the note goes, and it is kept.
    await start.click();
    await expect(month).toContainText(REVIEW_CUT);
    await again.click();
    await expect(month).toContainText(COMPLETE);
    await expect(again).toBeVisible();
    await expect(month).not.toContainText(REVIEW_CUT);
    await expect(month).not.toContainText(PARTIAL);
    await page.reload();
    await view.click();
    await expect(month).toContainText(COMPLETE);

    // Cut off over a complete one: after a reload the complete one is still there.
    await again.click();
    await expect(month).toContainText(PARTIAL_AGAIN);
    await expect(month).toContainText(REVIEW_CUT);
    await expect(again).toBeVisible();
    await page.reload();
    await view.click();
    await expect(month).toContainText(COMPLETE);
    await expect(month).not.toContainText(PARTIAL_AGAIN);
    await expect(month).not.toContainText(REVIEW_CUT);
    expect(calls.review["(month)"] - before).toBe(4);
    expect(reviewReplies).toHaveLength(0);
  });
});
