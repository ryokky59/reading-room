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
- 行動ログ: 下の「行動ログ」を参照。

## 行動ログ

どの記事を、どの端末で、どこから開き、どれだけ読み、何をしたかを `events` テーブルに 1 イベント 1 行で貯める(アプリに画面はない)。ブラウザの `track()`(`src/lib/track.ts`)が `POST /api/activity` に送る。送れなかったイベントは捨て、再送しない。UA・IP・入力内容は残さない。種別などの値の一覧は `src/lib/events.ts`。読むときは下の書き出しスクリプトを使い、出たファイルを Claude に渡す。

### 列

| 列 | 内容 |
| --- | --- |
| `created_at` | サーバーが受け取った時刻 |
| `env` | `VERCEL_ENV`(`production` / `preview`)、無ければ `development`。プレビューも本番 DB に書くので、分析ではここで除く |
| `session_id` | ブラウザのタブごとの乱数(再読み込みでは変わらない) |
| `type` | イベントの種別。`open`(記事を開いた)、`leave`(記事での滞在とスクロール、下に説明)、操作のイベント(下の表) |
| `device` | `phone`(ポインタが指 = `(pointer: coarse)`)/ `pc`。タブレットと開いた折りたたみも `phone` に入る(`vw` で分けられる) |
| `layout` | `single`(一覧と記事が別画面)/ `split`(幅 600px 以上で横に並ぶ) |
| `vw` / `vh` | 送った時の画面の幅と高さ(CSS px)。端末を後から分け直すのに使う |
| `standalone` | ホーム画面から起動したか |
| `screen` | 送った時の画面: `board` / `list` / `article` / `read` / `feeds`。`open` と `leave` は `article`。操作のイベントは押したボタンのある画面(PC で記事の横の一覧で押したものは `list`) |
| `article_id` | 記事(`articles.id`)。記事が消えると null |
| `source` | 記事をどこから開いたか(`open` のみ、下の表) |
| `view_id` | 記事を 1 回開くごとの乱数。同じ閲覧中のイベントは同じ値を持つ。一覧の切り替えや再取得では変わらない。操作のイベントでは記事の画面で押したものだけに付く |
| `dwell_ms` | `leave` のみ。記事を開いてからタブが見えていた時間の合計(ミリ秒)。隠れている間は進まない |
| `active_ms` | `leave` のみ。最後にスクロール・キー・ポインタの入力があった時点の `dwell_ms`。`dwell_ms` との差が、操作せずに開いたままだった時間。何分で放置とみなすかは分析の側で決める。PC では横の一覧のスクロールやマウスを動かしただけでも進むので、スマホより大きめに出る |
| `scroll_pct` | `leave` のみ。本文(`<main>`)のうち画面に入った最も下の位置の割合、0〜100。送った時点の本文の高さで割る(翻訳が伸びると下がることがある) |
| `props` | 種別ごとの補足(JSON)。`leave` は `body_lang`(離れた時に見ていた本文、`ja` / `original`)。操作のイベントは下の表。`open` では null |

### 種別

| `source` | 開き方 |
| --- | --- |
| `board` | ボードの行から |
| `list` | フィード一覧のカードから(PC で記事の横の一覧から選んだ場合も) |
| `next` | 読了・スキップの後に自動で開いた次の記事(自分で選んだ記事ではない) |
| `key` | j / k で移った |
| `read` | 読了一覧から |
| `direct` | URL を直接開いた、再読み込み |

`next` と `key` 以外は直前の画面で決まる。ブラウザの戻る・進むで記事に入った場合も同じで、別の記事からなら `list` になる。「URL を追加」から開いた記事は `board` か `list` になる(`articles.feed_id IS NULL` で見分ける)。

`leave` は記事を離れた時(別の記事へ、一覧へ、読了・スキップ、ブラウザの戻る)と、タブが隠れた時(`visibilitychange`)、ページが閉じられる時(`pagehide`)に、その閲覧の `open` と同じ `view_id` で送る。値は開いてからの累積なので、**同じ `view_id` の `leave` が何行かあれば最後の行を使う(`created_at` が最も新しい行。ほぼ同時に届いた行は `dwell_ms` が大きい方)**。iPhone でアプリを終了した時などは届かないことがあり、その閲覧は `open` だけが残る。

操作のイベントは保存が成功した後に 1 回送る(失敗した時は送らない)。`article_id` は操作した記事。

| `type` | 操作 | `screen` | `props` |
| --- | --- | --- | --- |
| `read` | 「読了にする」 | `article` | `via`: `button`(ボタン)/ `key`(PC の e) |
| `skip` | 「スキップ」 | `article`(記事の中)/ `list`(一覧のカード、`view_id` なし) | `via`: `button` / `key`(PC の s) |
| `undo` | トーストの「元に戻す」 | 押した時の画面(当てにならない)。`of` が `seen_all` の時は「すべて既読」を押した画面 | `of`: 元に戻した操作(`read` / `skip` / `seen_all`)。`seen_all` の時は `article_id` なしで、その `seen_all` と同じ `feedId` / `folderId` と `seenAt` が付く |
| `restore` | 読了済みの記事の「未読に戻す」 | `article` | なし |
| `unsee` | 既読のカードの「未読に戻す」 | `list` | なし |
| `seen_all` | 「すべて既読」 | `board`(ボードの列・フォルダ)/ `list` | `feedId` か `folderId` のどちらか 1 つ。null は「フィードなし」「未分類」。`seenAt`: 既読にした記事に付けた `seen_at`(ms の整数)。`article_id` なし |
| `chat` | AI への送信(応答を待たずに記録。AI が失敗しても 1 行) | `article` | `kind`: `summary`(要約してもらう)/ `message`(質問)。本文は入れない |
| `original` | 「元記事を開く」(クリックと中クリックだけ。長押しのメニューからは残らない) | `article` | なし |
| `feed_pause` / `feed_resume` | 記事ページからサイトの取得を止める / 再開する | `article` | `feedId` |

`props` のキーは `leave` だけ snake_case(`body_lang`)で、操作のイベントは camelCase(`feedId` など)。

### 書き出す

`scripts/export-activity.mts` が `events` と記事・フィード・フォルダを読み、`.data/exports/` に JSON を 3 つ書き、記録の健康状態を表示する。すべての問い合わせを 1 つの READ ONLY トランザクションで流すので、DB は変わらない。

```bash
# 手元の PGlite(PGLITE_DIR、既定 .data/pglite)。npm run dev を止めてから
npx tsx scripts/export-activity.mts

# 本番 Neon。接続文字列は手元に置かず、実行の時だけ渡す
DATABASE_URL="$(npx neonctl connection-string main --project-id round-feather-65545481)" npx tsx scripts/export-activity.mts
```

| 引数 | 意味 |
| --- | --- |
| `--days N` | 直近 N 日(既定 90) |
| `--from YYYY-MM-DD` / `--to YYYY-MM-DD` | 期間を日付で(日本時間。`--to` の日を含む)。`--from` があると `--days` は使わない |
| `--env production` | 含める `env`。カンマ区切りで複数、`all` ですべて(既定 `production`) |

例: `npx tsx scripts/export-activity.mts --from 2026-11-01 --env production,preview`

表示されるもの: 最後のイベントの時刻、直近 14 日の日別の行数(日本時間。0 の日が続いたら記録が止まっている)、期間内の `open` のうち `leave` が届かなかった閲覧の割合。期間にイベントが無ければ「記録がありません」と出る(ファイルは書き、`views` と `actions` は空になる)。同じ PGlite のディレクトリを、動いているサーバー(`npm run dev`、E2E)と同時に開かないこと。

書き出したファイルには記事のタイトルとサイト名が入る。`.data/` の外に出さない(`.data/` は gitignore 済み)。どのファイルも `{ "meta": { 期間, env }, "rows": [...] }` の形。

- `views.json`: 閲覧 1 回(`view_id`)= 1 行。`open` と、同じ `view_id` の**最後の** `leave` をまとめたもの。
  - 記事: `articleId`、`title`(日本語のタイトル)、`site`(`articles.source`)、`feedId`、`folder`(フィードが無い記事は「未分類」)、`charCount`、`lang`
  - 端末と開き方: `device`、`layout`、`vw` / `vh`、`standalone`、`sessionId`、`openedAt`、`source`
  - 読み方: `leftAt`、`dwellMs`、`activeMs`、`scrollPct`、`bodyLang`(どれも最後の `leave` から。届かなかった閲覧は null)、`leaveRows`(届いた `leave` の行数)
  - その閲覧での操作: `actions`(記事の中で押した `read` / `skip` / `chat` / `original` など)、`outcome`(取り消されなかった最後の `read` / `skip`)
- `actions.json`: 操作のイベント 1 つ = 1 行。記事・サイト・フォルダ・端末の列に加えて:
  - `via` / `kind` / `of`: `props` を列にしたもの
  - `target`: `seen_all` と、それを取り消した `undo` の対象(`kind` が `feed` か `folder`、`id`、`name`)と `feed_pause` / `feed_resume` のサイト。`seen_all` は `props` に `feedId` と `folderId` のどちらのキーがあるかで決め、値が null なら「フィードなし」「未分類」
  - `seenArticleIds`: `seen_all` で既読になったと推定した記事(下の注意)。取り消された `seen_all` は空
  - `openedBefore`: その記事にそれより前の `open` があったか(どのタブでも。`--env` に関係なく、プレビューで開いたものも含む)
  - `unopenedSkip`: `skip` のうち、一覧のカードからで、それまで一度も開いていない記事なら true
  - `undone`(`read` / `skip` / `seen_all`)と `undoes`(`undo`): 「元に戻す」との対応。`undoes` が null の `undo` は、対になる行が見つからなかったもの
- `feeds.json`: サイトごとの集計(フィードは `feeds` の 1 行ごと、URL から追加した記事は `site` ごと)。
  - `fetched`: 期間内に取得した記事の数(`articles.fetched_at`)
  - `opened` / `read` / `skipped`: 期間内に開いた・読了にした・スキップした記事の数(「元に戻す」で取り消したものは除く)
  - `skippedUnopened`: 開かずにスキップした記事(`actions` の `unopenedSkip`)
  - `seenUnopened`: 開かずに「すべて既読」で既読にした記事(取り消された「すべて既読」は数えない)
  - `byDevice`: 端末ごとの `opens` / `reads` / `skips` と、`leave` が届いた閲覧の数(`views`)と `dwell_ms` の中央値(`medianDwellMs`)

### 読むときの注意

- **`leave` は同じ `view_id` の最後の行を使う。** 値は累積で、タブを隠すたびに行が増える。`views.json` はそうしてある。
- **短い記事は到達度が最初から 100 になる。** 画面に収まる記事は開いた時点で `scroll_pct` が 100。`charCount` と合わせて見る。
- **`source = next` は自分で選んだ記事ではない。** 読了・スキップの後に自動で開いたもの。興味を測るときは除くか分けて見る。
- **プレビューの行は `env` で除く。** プレビューも本番 DB に書く。スクリプトは既定で `production` だけを読む。
- **記録を始める前の操作には行がない。** それより前のスキップや既読には時刻が残っていないので、期間の始まりを記録の開始より後にする。
- **`device = phone` にはタブレットと開いた折りたたみも入る。** `vw` で分けられる。
- `screen = list` の操作には、PC で記事の横に出ている一覧で押したものも入る。`layout = 'split'` で分け、開いていた記事自身のカードかは `openedBefore` で見る。
- `undo` の `screen` は URL で決まるので当てにならない。元の操作とは `article_id` と時刻で結び付けてあり(10 分前までの直前のもの。無ければ 5 秒後までのもの)、元の行が無いこともある(カードのスキップは、「元に戻す」の後に保存が失敗することがある)。
- **「すべて既読」の「元に戻す」は `props.seenAt` で結び付ける。** `of` が `seen_all` の `undo` は記事を持たず、`seenAt` が同じ `seen_all` と対にする(1 回の「すべて既読」が付ける `seen_at` は 1 つの値で、「元に戻す」はその値の記事を未読に戻す)。`undo` の `screen` は「すべて既読」を押した画面。
- **「すべて既読」の取り消しは、2026-11-22 から #117 が本番に出るまで記録がない。** 「元に戻す」が付いた #115(2026-11-22)からこの記録が始まるまでの `seen_all` は、`seenAt` も無く、取り消されたかどうか分からない(`undone` は false になる)。
- 「すべて既読」で既読になった記事の一覧は残らない。対象のサイト・フォルダの記事のうち、`articles.seen_at` がイベントの 2 分前から 5 秒後までのものと推定する。記事を開いても `seen_at` が付くので、`seen_at` の直後(30 秒以内)に `open` がある記事は、開いて既読になったものとして除く。その後に「未読に戻す」された記事は `seen_at` が消えるので数えられない。フォルダはいまの所属で決める。
- `chat` は送った回数で、AI を使えた回数ではない。
