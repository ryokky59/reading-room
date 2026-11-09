import "server-only";
import Anthropic from "@anthropic-ai/sdk";
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

/** Streams the assistant's reply as plain text; `onDone` receives the full text. */
export function streamChat(article: Article, turns: Turn[], onDone: (text: string) => Promise<void>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
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
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          const note = "\n\n(この内容には回答できませんでした)";
          full += note;
          controller.enqueue(encoder.encode(note));
        }
        if (full.trim()) await onDone(full);
      } catch (err) {
        console.error("chat stream failed", err);
        controller.enqueue(encoder.encode("\n\n(エラーが発生しました。もう一度試してください)"));
      } finally {
        controller.close();
      }
    },
  });
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
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
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
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        if (full.trim()) await onDone(full);
      } catch (err) {
        console.error("review stream failed", err);
        controller.enqueue(encoder.encode("\n\n(エラーが発生しました。もう一度試してください)"));
      } finally {
        controller.close();
      }
    },
  });
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
  const encoder = new TextEncoder();
  // ArticleView's Translation shows 「やり直す」 when it sees this text.
  const failure = "\n\n(日本語にまとめられませんでした。やり直してください)";
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const stream = client.messages.stream({
          model: FAST_MODEL,
          max_tokens: 32000,
          output_config: { effort: "low" },
          system: `あなたはテック・ビジネス記事を日本語の読者に紹介する編集者です。英語などの記事を、日本語だけで内容をしっかり理解できるように詳しく紹介します。
- 記事の流れに沿って、段落やセクションごとに要点を日本語でまとめる。見出しがあれば「## 見出し」で残す。
- 数字・固有名詞・主張の根拠は省かない。鍵になる発言は短く引用し、日本語訳を添える。
- 書き手の主張とあなたの補足は混ぜない。前置きや締めの挨拶は書かない。
- 製品名・社名・人名は一般的な表記に。定着したカタカナ語がなければ原語のまま。`,
          messages: [{ role: "user", content: `<title>${a.title}</title>\n<body>\n${a.markdown}\n</body>` }],
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        // Only a complete translation is kept, so a cut-off one is retried next time.
        if (final.stop_reason === "end_turn" && full.trim()) await onDone(full);
        else if (final.stop_reason === "refusal" || !full.trim()) controller.enqueue(encoder.encode(failure));
      } catch (err) {
        console.error("translation failed", err);
        controller.enqueue(encoder.encode(failure));
      } finally {
        controller.close();
      }
    },
  });
}
