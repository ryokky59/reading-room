# Reading Room

テックとビジネスの記事を毎朝自動で集め、スマホで読みながら Claude と対話するための個人用 Web アプリ。

- **新着**: 登録したフィードからおよそ1時間おきに取得し、本文を抽出して保存する。「今すぐ取得」と「URL を追加」で手動でも追加できる。
- **フィード**: サイトの URL を入れると RSS を自動で探して登録する。止める・削除もここから。
- **記事ページ**: 本文を読みながら「AI に質問する」で対話できる。英語の記事は日本語で読める。
- **読了**: 「読了にする」で読了一覧へ移る(「スキップ」で外す)。AI との対話は記事ごとに残る。
- **読了一覧**: 月ごとに学びを一覧でき、「この月を振り返る」で AI が月の振り返りを書く。

構成は Next.js 16 (App Router)、Neon Postgres (Drizzle)、Claude API (Opus 5.5 / Sonnet 5.5 / Haiku 5.5)、Vercel Cron。

## ローカルで動かす

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, CRON_SECRET を埋める
npm run dev
```

ローカルにはログインがないので、同じ Wi-Fi の端末からも開ける点に注意。
`DATABASE_URL` が空なら `.data/pglite` に埋め込み Postgres (PGlite) を作り、自動でマイグレーションする。
フィードの取得を試すには次を実行する。

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

## デプロイ (Vercel)

1. `npx vercel login` のあと `npx vercel link` でプロジェクトを作る。
2. Vercel のダッシュボードで Storage → Neon を追加する(`DATABASE_URL` が自動で入る)。
3. 環境変数 `ANTHROPIC_API_KEY`、`CRON_SECRET` を Production に追加する。
4. スキーマを作る: `npx vercel env pull .env.production.local` のあと `DATABASE_URL=... npx drizzle-kit migrate` を実行する。
5. Settings → Deployment Protection で Vercel Authentication を「All Deployments」にする。アプリ自体にはログイン機能がなく、本番も含めてこれで守る(cron はそのまま動く)。
6. `npx vercel deploy --prod` でデプロイする。cron は `vercel.json` で設定済み。Hobby プランの cron は1日1回までなので、時刻をずらした24本を並べて毎時取得にしている(実行時刻は ±59 分ずれる)。

スマホではブラウザで開いて「ホーム画面に追加」するとアプリのように使える。

## 運用

- フィードは画面の「フィード」タブで管理する。初期セットは `drizzle/0002_seed_feeds.sql`。1回に取る件数 (`item_limit`) と対象日数 (`days`) は DB の列で持つ。
- スキーマを変えたら `npx drizzle-kit generate` でマイグレーションを作り、`drizzle-kit migrate` で Neon に適用する。
- モデルは環境変数で変えられる。読書メモと月の振り返りは `ANTHROPIC_MODEL`(既定 `claude-opus-5-5`)、記事との対話は `ANTHROPIC_CHAT_MODEL`(既定 `claude-sonnet-5-5`)、一覧の要約と日本語まとめは `ANTHROPIC_FAST_MODEL`(既定 `claude-haiku-5-5`)。
- 行動ログ: どの記事を、どの端末で、どこから開き、どれだけ読んだかを `events` テーブルに 1 イベント 1 行で貯める(画面はない)。ブラウザの `track()`(`src/lib/track.ts`)が `POST /api/activity` に送る。送れなかったイベントは捨て、再送しない。UA・IP・入力内容は残さない。種別などの値の一覧は `src/lib/events.ts`。

  | 列 | 内容 |
  | --- | --- |
  | `created_at` | サーバーが受け取った時刻 |
  | `env` | `VERCEL_ENV`(`production` / `preview`)、無ければ `development`。プレビューも本番 DB に書くので、分析ではここで除く |
  | `session_id` | ブラウザのタブごとの乱数(再読み込みでは変わらない) |
  | `type` | イベントの種別。`open`(記事を開いた)、`leave`(記事での滞在とスクロール、下に説明)、操作のイベント(下の表) |
  | `device` | `phone`(ポインタが指 = `(pointer: coarse)`)/ `pc`。タブレットと開いた折りたたみも `phone` に入る |
  | `layout` | `single`(一覧と記事が別画面)/ `split`(幅 600px 以上で横に並ぶ) |
  | `vw` / `vh` | 送った時の画面の幅と高さ(CSS px)。端末を後から分け直すのに使う |
  | `standalone` | ホーム画面から起動したか |
  | `screen` | 送った時の画面: `board` / `list` / `article` / `read` / `feeds`。`open` と `leave` は `article`。操作のイベントは押したボタンのある画面(PC で記事の横の一覧で押したものは `list`) |
  | `article_id` | 記事(`articles.id`)。記事が消えると null |
  | `source` | 記事をどこから開いたか(`open` のみ、下の表) |
  | `view_id` | 記事を 1 回開くごとの乱数。同じ閲覧中のイベントは同じ値を持つ。一覧の切り替えや再取得では変わらない。操作のイベントでは記事の画面で押したものだけに付く |
  | `dwell_ms` | `leave` のみ。記事を開いてからタブが見えていた時間の合計(ミリ秒)。隠れている間は進まない |
  | `active_ms` | `leave` のみ。最後にスクロール・キー・ポインタの入力があった時点の `dwell_ms`。`dwell_ms` との差が、操作せずに開いたままだった時間。何分で放置とみなすかは分析の側で決める |
  | `scroll_pct` | `leave` のみ。本文(`<main>`)のうち画面に入った最も下の位置の割合、0〜100。送った時点の本文の高さで割る(翻訳が伸びると下がることがある) |
  | `props` | 種別ごとの補足。`leave` は `body_lang`(離れた時に見ていた本文、`ja` / `original`)。操作のイベントは下の表。`open` では null |

  | `source` | 開き方 |
  | --- | --- |
  | `board` | ボードの行から |
  | `list` | フィード一覧のカードから(PC で記事の横の一覧から選んだ場合も) |
  | `next` | 読了・スキップの後に自動で開いた次の記事(自分で選んだ記事ではない) |
  | `key` | j / k で移った |
  | `read` | 読了一覧から |
  | `direct` | URL を直接開いた、再読み込み |

  `next` と `key` 以外は直前の画面で決まる。ブラウザの戻る・進むで記事に入った場合も同じで、別の記事からなら `list` になる。「URL を追加」から開いた記事は `board` か `list` になる(`articles.feed_id IS NULL` で見分ける)。

  `leave` は記事を離れた時(別の記事へ、一覧へ、読了・スキップ、ブラウザの戻る)と、タブが隠れた時(`visibilitychange`)、ページが閉じられる時(`pagehide`)に、その閲覧の `open` と同じ `view_id` で送る。値は開いてからの累積なので、**同じ `view_id` の `leave` が何行かあれば最後の行を使う(`created_at` が最も新しい行。ほぼ同時に届いた行は `dwell_ms` が大きい方)**。iPhone でアプリを終了した時などは届かないことがあり、その閲覧は `open` だけが残る。画面に収まる短い記事は開いた時点で `scroll_pct` が 100 になるので、到達度は `articles.char_count` と合わせて見る。

  操作のイベントは保存が成功した後に 1 回送る(失敗した時は送らない)。`article_id` は操作した記事。

  | `type` | 操作 | `screen` | `props` |
  | --- | --- | --- | --- |
  | `read` | 「読了にする」 | `article` | `via`: `button`(ボタン)/ `key`(PC の e) |
  | `skip` | 「スキップ」 | `article`(記事の中)/ `list`(一覧のカード、`view_id` なし) | `via`: `button` / `key`(PC の s) |
  | `undo` | トーストの「元に戻す」 | 押した時の画面 | `of`: 元に戻した操作(`read` / `skip`) |
  | `restore` | 読了済みの記事の「未読に戻す」 | `article` | なし |
  | `unsee` | 既読のカードの「未読に戻す」 | `list` | なし |
  | `seen_all` | 「すべて既読」 | `board`(ボードの列・フォルダ)/ `list` | `feedId` か `folderId` のどちらか 1 つ。null は「フィードなし」「未分類」。`article_id` なし |
  | `chat` | AI への送信(応答を待たずに記録) | `article` | `kind`: `summary`(要約してもらう)/ `message`(質問)。本文は入れない |
  | `original` | 「元記事を開く」 | `article` | なし |
  | `feed_pause` / `feed_resume` | 記事ページからサイトの取得を止める / 再開する | `article` | `feedId` |

  「すべて既読」で既読になった記事の一覧は残らない。対象の id と `created_at` から、`articles.seen_at` がほぼ同じ時刻の行で推定する。開かずに飛ばした記事は、`screen = 'list'` の `skip` と、`open` が 1 行もないまま `seen_at` が付いた記事で見る。この記録を始める前のスキップには時刻がない。
