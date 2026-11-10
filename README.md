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
- 行動ログ: どの記事を、どの端末で、どこから開いたかを `events` テーブルに 1 イベント 1 行で貯める(画面はない)。ブラウザの `track()`(`src/lib/track.ts`)が `POST /api/activity` に送る。送れなかったイベントは捨て、再送しない。UA・IP・入力内容は残さない。種別などの値の一覧は `src/lib/events.ts`。

  | 列 | 内容 |
  | --- | --- |
  | `created_at` | サーバーが受け取った時刻 |
  | `env` | `VERCEL_ENV`(`production` / `preview`)、無ければ `development`。プレビューも本番 DB に書くので、分析ではここで除く |
  | `session_id` | ブラウザのタブごとの乱数(再読み込みでは変わらない) |
  | `type` | イベントの種別。今は `open`(記事を開いた)だけ |
  | `device` | `phone`(ポインタが指 = `(pointer: coarse)`)/ `pc`。タブレットと開いた折りたたみも `phone` に入る |
  | `layout` | `single`(一覧と記事が別画面)/ `split`(幅 600px 以上で横に並ぶ) |
  | `vw` / `vh` | 送った時の画面の幅と高さ(CSS px)。端末を後から分け直すのに使う |
  | `standalone` | ホーム画面から起動したか |
  | `screen` | 送った時の画面: `board` / `list` / `article` / `read` / `feeds`。`open` は `article` |
  | `article_id` | 記事(`articles.id`)。記事が消えると null |
  | `source` | 記事をどこから開いたか(`open` のみ、下の表) |
  | `view_id` | 記事を 1 回開くごとの乱数。同じ閲覧中のイベントは同じ値を持つ。一覧の切り替えや再取得では変わらない |
  | `dwell_ms` / `active_ms` / `scroll_pct` / `props` | 後続の種別用(滞在時間、操作した時間、スクロール到達度、種別ごとの補足)。`open` では null |

  | `source` | 開き方 |
  | --- | --- |
  | `board` | ボードの行から |
  | `list` | フィード一覧のカードから(PC で記事の横の一覧から選んだ場合も) |
  | `next` | 読了・スキップの後に自動で開いた次の記事(自分で選んだ記事ではない) |
  | `key` | j / k で移った |
  | `read` | 読了一覧から |
  | `direct` | URL を直接開いた、再読み込み |

  `next` と `key` 以外は直前の画面で決まる。ブラウザの戻る・進むで記事に入った場合も同じで、別の記事からなら `list` になる。「URL を追加」から開いた記事は `board` か `list` になる(`articles.feed_id IS NULL` で見分ける)。
