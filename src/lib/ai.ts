import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import type { Article } from "./db";

const client = new Anthropic();

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
// The chat is interactive, so it favors a fast first reply over deep deliberation.
export const CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-5-5";
// Runs once per fetched article (digest) and per opened foreign article (translation),
// so it uses the fast, low-cost model.
export const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-5-5";

// On a safety-classifier decline, the API retries on Anthropic's recommended model.
const FALLBACK: Pick<Anthropic.Beta.MessageCreateParams, "betas" | "fallbacks"> = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

const SYSTEM = `あなたはユーザーの読書パートナーです。ユーザーはテックやビジネスの記事を読み、理解を深めたいと考えています。

- 返答は日本語で書く。スマホで読むので、短い段落と箇条書きで簡潔にまとめる。
- 英語の記事から引用するときは、原文のあとに日本語訳を添える。
- 記事に書かれていることと、あなた自身の見解や背景知識は区別して示す。
- 一方的に解説するより、ユーザーが自分の考えを言葉にできるよう問いを投げかける。`;

export const KICKOFF = `この記事を読み始めます。次の形でまとめてください。

**3行要約**
**押さえるべき論点**(3〜5個)
**問いかけ**(私が考えるきっかけになる問いを1つ)`;

function articleBlock(a: Article): string {
  const body = a.contentText ?? a.excerpt ?? "(本文を取得できませんでした。タイトルと URL から分かる範囲で答えてください)";
  return `<article>
<title>${a.title}</title>
<source>${a.source}</source>
<url>${a.url}</url>
<body>
${body}
</body>
</article>`;
}

function systemFor(a: Article): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    {
      type: "text",
      text: `${SYSTEM}
- 質問への返答は要点を絞り、長くても 400 字程度に収める。詳しく求められたときだけ長く書く。`,
    },
    // The article is the stable prefix for every turn on this page, so cache it.
    { type: "text", text: articleBlock(a), cache_control: { type: "ephemeral" } },
  ];
}

export type Turn = { role: "user" | "assistant"; content: string };

/**
 * A text stream that `produce` writes to with `send`. The reader can go away mid-way (the page is
 * closed or left): from then on `send` does nothing, and `produce` carries on unless it watches
 * `signal`, which is aborted at that moment. `produce` must not throw; it reports its own errors.
 * With `finish`, the function is kept running until `produce` ends (after(), which is waitUntil
 * on Vercel), so a reply asked for is still saved after the page is left.
 */
function textStream(
  produce: (send: (text: string) => void, signal: AbortSignal) => Promise<void>,
  { finish = false } = {},
) {
  const encoder = new TextEncoder();
  const left = new AbortController();
  let open = true;
  let done: Promise<void> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      done = produce(send, left.signal).finally(() => {
        if (!open) return;
        open = false;
        controller.close();
      });
    },
    cancel() {
      open = false;
      left.abort();
    },
  });
  if (finish) after(() => done);
  return stream;
}

/** Streams the assistant's reply as plain text; `onDone` receives the full text. */
// It is finished and saved even when the page is left mid-way: the user asked for it, and its input
// is already paid for.
export function streamChat(article: Article, turns: Turn[], onDone: (text: string) => Promise<void>) {
  return textStream(
    async (send) => {
      let full = "";
      try {
        const stream = client.beta.messages.stream({
          model: CHAT_MODEL,
          max_tokens: 64000,
          output_config: { effort: "low" },
          system: systemFor(article),
          messages: turns,
          ...FALLBACK,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            send(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          const note = "\n\n(この内容には回答できませんでした)";
          full += note;
          send(note);
        } else if (final.stop_reason === "max_tokens" && full.trim()) {
          // Kept and saved: the user's turn is already stored, and a later "続きを" picks up from here.
          // No 「エラー」 in it: ArticleView offers a new summary when the last reply contains that word.
          const note = "\n\n(返答が長くなり、ここまでで切れました)";
          full += note;
          send(note);
        }
        if (full.trim()) await onDone(full);
      } catch (err) {
        // Also a failed save after the page was left: nobody is there to tell, so it is only logged.
        console.error("chat stream failed", err);
        send("\n\n(エラーが発生しました。もう一度試してください)");
      }
    },
    { finish: true },
  );
}

export type ReviewItem = Pick<Article, "title" | "titleJa" | "source" | "summary" | "learning" | "memo"> & {
  folder: string | null; // null means unfiled
  chat: { role: "user" | "assistant"; content: string }[];
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Streams a monthly look-back built from that month's articles and the conversations about them. */
export function streamReview(month: string, items: ReviewItem[], onDone: (text: string) => Promise<void>) {
  const list = items
    .map((i) => {
      const lines = [`## ${i.titleJa || i.title} (${i.source} / ${i.folder ?? "未分類"})`];
      if (i.summary) lines.push(`要約: ${i.summary}`);
      if (i.learning) lines.push(`学び: ${i.learning}`);
      if (i.memo) lines.push(`メモ: ${i.memo}`);
      if (i.chat.length > 0) {
        lines.push("対話:");
        // The user's own words say the most about their interest, so they are kept longer.
        for (const m of i.chat) {
          lines.push(m.role === "user" ? `- ユーザー: ${clip(m.content, 800)}` : `- AI: ${clip(m.content, 400)}`);
        }
      } else {
        lines.push("(対話なし)");
      }
      return lines.join("\n");
    })
    .join("\n\n");
  // Both notes end with 「作り直してください)」, which tells a failed look-back from a kept one.
  const failure = "\n\n(この月の振り返りは作れませんでした。作り直してください)";
  const cutOff = "\n\n(振り返りが長くなり、ここまでで切れました。作り直してください)";
  // Like a chat reply, it is finished and saved when the page is left mid-way.
  return textStream(
    async (send) => {
      let full = "";
      try {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          output_config: { effort: "medium" },
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: `${month} に読んだ記事 ${items.length} 本と、それぞれについてあなたと交わした対話です。

${list}

この月の振り返りを書いてください。対話でユーザーが質問したことや自分の言葉で話したことを特に手がかりにしてください。
- 関心がどこに向いていたか(テーマの傾向)
- 対話から見えるユーザーの問題意識や考えの変化
- 記事をまたいで見えてくるつながり
- 来月深掘りするとよさそうなテーマや問い`,
            },
          ],
          ...FALLBACK,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            send(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        // A month has one look-back, so a failed or cut-off one is shown but not kept: saving it
        // would replace a complete one.
        if (final.stop_reason === "refusal" || !full.trim()) send(failure);
        else if (final.stop_reason === "max_tokens") send(cutOff);
        else await onDone(full);
      } catch (err) {
        console.error("review stream failed", err);
        send("\n\n(エラーが発生しました。もう一度試してください)");
      }
    },
    { finish: true },
  );
}

export type Digest = { lang: "ja" | "other"; titleJa: string; summary: string };

/** Detects the language, translates the title and writes a short summary for the inbox. */
export async function digestArticle(a: { title: string; text: string | null; excerpt: string | null }): Promise<Digest> {
  const body = (a.text ?? a.excerpt ?? "").slice(0, 8000);
  const stream = client.messages.stream({
    model: FAST_MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            lang: { type: "string", enum: ["ja", "other"] },
            title_ja: { type: "string" },
            summary: { type: "string" },
          },
          required: ["lang", "title_ja", "summary"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `<title>${a.title}</title>
<body>
${body || "(本文なし)"}
</body>

この記事について次を返してください。
- lang: 記事本文が日本語なら "ja"、それ以外なら "other"
- title_ja: タイトルの自然な日本語訳。日本語の記事なら元のタイトルをそのまま
- summary: 記事の要点を日本語 1 文(40〜60 字)で。本文がなければタイトルから分かる範囲で 1 文`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("refused");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(text) as { lang: "ja" | "other"; title_ja: string; summary: string };
  const summary = out.summary.trim();
  if (!summary) throw new Error("empty summary");
  return { lang: out.lang, titleJa: out.title_ja.trim() || a.title, summary };
}

/**
 * Streams a detailed Japanese walkthrough of a non-Japanese article (Markdown);
 * `onDone` receives the full text. It follows the article section by section
 * rather than reproducing it in full, since the articles are others' copyrighted work.
 */
export function streamTranslation(a: { title: string; markdown: string }, onDone: (text: string) => Promise<void>) {
  // ArticleView's Translation shows 「やり直す」 when the text ends with 「やり直してください)」.
  const failure = "\n\n(日本語にまとめられませんでした。やり直してください)";
  const cutOff = "\n\n(記事が長く、ここまでで切れました。やり直してください)";
  // Unlike a chat reply, it stops when the page is left, and nothing is kept: opening an article
  // starts it, and finishing the ones passed with j / k would pay for translations nobody reads.
  return textStream(async (send, left) => {
    let full = "";
    try {
      const stream = client.messages.stream(
        {
          model: FAST_MODEL,
          max_tokens: 32000,
          output_config: { effort: "low" },
          system: `あなたはテック・ビジネス記事を日本語の読者に紹介する編集者です。英語などの記事を、日本語だけで内容をしっかり理解できるように詳しく紹介します。
- 記事の流れに沿って、段落やセクションごとに要点を日本語でまとめる。見出しがあれば「## 見出し」で残す。
- 数字・固有名詞・主張の根拠は省かない。鍵になる発言は短く引用し、日本語訳を添える。
- 書き手の主張とあなたの補足は混ぜない。前置きや締めの挨拶は書かない。
- 製品名・社名・人名は一般的な表記に。定着したカタカナ語がなければ原語のまま。`,
          messages: [{ role: "user", content: `<title>${a.title}</title>\n<body>\n${a.markdown}\n</body>` }],
        },
        { signal: left },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          full += event.delta.text;
          send(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (left.aborted) return;
      // Only a complete translation is kept, so a cut-off one is retried next time.
      if (final.stop_reason === "end_turn" && full.trim()) await onDone(full);
      else if (final.stop_reason === "max_tokens" && full.trim()) send(cutOff);
      else send(failure);
    } catch (err) {
      // Left mid-way: the request to the API was stopped on purpose, which is not a failure.
      if (left.aborted) return;
      console.error("translation failed", err);
      send(failure);
    }
  });
}

export type PickCandidate = { id: number; title: string; summary: string; source: string; minutes: number | null };
export type PickChoice = { id: number; reason: string };

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Chooses up to five of `candidates` for the morning's 「今朝の 5 本」, each with a one-line reason.
 * `read` are articles the owner finished lately, as a hint of what they like. The ids that come
 * back are not checked here: lib/picks.ts keeps only the candidates' own.
 */
export async function chooseMorningPicks(
  candidates: PickCandidate[],
  read: { title: string; source: string }[],
): Promise<PickChoice[]> {
  const list = candidates
    .map(
      (c) =>
        `<article id="${c.id}"><title>${escapeXml(c.title)}</title><site>${escapeXml(c.source)}</site>${
          c.minutes === null ? "" : `<minutes>${c.minutes}</minutes>`
        }<summary>${escapeXml(c.summary)}</summary></article>`,
    )
    .join("\n");
  const done = read.map((r) => `<article><title>${escapeXml(r.title)}</title><site>${escapeXml(r.source)}</site></article>`).join("\n");
  const stream = client.messages.stream({
    model: FAST_MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            picks: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "integer" }, reason: { type: "string" } },
                required: ["id", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["picks"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `この 24 時間に届いた未読の記事です。

<candidates>
${list}
</candidates>

ユーザーが最近 30 日に読み終えた記事です(好みの手がかり)。

<read>
${done || "(まだありません)"}
</read>

ユーザーはテックやビジネスの記事を、主にスマホで読みます。候補の中から、今日読むとよい記事を最大 5 本選んでください。
- 読み終えた記事から見える関心に近いものを中心に、同じ話題やサイトに偏りすぎないように。
- picks: 読む順に並べる。id は候補の id、reason は「なぜ今日これか」を日本語 1 文(40 字前後)で。要約に書かれていないことは書かない。`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("refused");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(text) as { picks: { id: number; reason: string }[] };
  return out.picks.map((p) => ({ id: p.id, reason: p.reason.trim() }));
}
