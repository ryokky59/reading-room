"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  markRead,
  nextInboxArticle,
  restoreArticle,
  setArticleFeedEnabled,
  skipArticle,
  updateNote,
} from "@/lib/actions";
import type { ArticleStatus } from "@/lib/db/schema";
import { hostname, isForeign, readingMinutes } from "@/lib/format";
import { BusyButton } from "./BusyButton";
import { FolderBadge } from "./Header";
import { isTyping, isWide, refreshAfterLeave, useInboxIds, useLeftInbox } from "./InboxShell";
import { Markdown } from "./Markdown";
import { useNavPending } from "./NavPending";

type ArticleProps = {
  id: number;
  title: string;
  titleJa: string | null;
  lang: string | null;
  url: string;
  source: string;
  feedId: number | null; // null for articles added by URL or whose feed was deleted
  feedEnabled: boolean;
  folder: string | null; // null means unfiled (未分類)
  contentHtml: string | null;
  contentJa: string | null;
  hasText: boolean;
  excerpt: string | null;
  charCount: number;
  status: ArticleStatus;
  learning: string | null;
  memo: string | null;
};

type Msg = { id: number; role: "user" | "assistant"; content: string };

/** The buttons that save and leave the article. */
type LeaveKind = "read" | "skip" | "restore";

let tempId = -1;

export function ArticleView({
  article,
  inboxHref,
  initialMessages,
}: {
  article: ArticleProps;
  inboxHref: string; // the inbox with the filter the article was opened from
  initialMessages: Msg[];
}) {
  const router = useRouter();
  // Phones: the chat opens as a sheet over the article. Unfolded phones and narrow PCs (`split`
  // to `xl`): a drawer from the right.
  // Wide PCs: an always-visible column.
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  // The textareas are uncontrolled: on iPhone kana keyboards, React writing the value back
  // breaks the ゛/゜/小 key, which edits the character just typed.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [hasInput, setHasInput] = useState(false);
  const foreign = isForeign(article.lang, article.title);
  const canTranslate = foreign && article.hasText;
  const [bodyLang, setBodyLang] = useState<"ja" | "original">(canTranslate ? "ja" : "original");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(message?: string) {
    setStreaming(true);
    const replyId = tempId--;
    setMsgs((m) => [
      ...m,
      ...(message ? [{ id: tempId--, role: "user" as const, content: message }] : []),
      { id: replyId, role: "assistant", content: "" },
    ]);
    try {
      const res = await fetch(`/api/articles/${article.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message ? { message } : {}),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, content: x.content + chunk } : x)));
      }
    } catch {
      setMsgs((m) =>
        m.map((x) =>
          x.id === replyId ? { ...x, content: x.content + "\n\n(通信エラー。もう一度送ってください)" } : x,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  function startSummary() {
    setMsgs([]);
    void send();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || streaming) return;
    inputRef.current!.value = "";
    setHasInput(false);
    void send(text);
  }

  const done = article.status === "read";

  // With the list beside the article (`split` and up), reading or skipping opens the next one in it.
  const listIds = useInboxIds();
  const search = inboxHref.slice(1);
  // Which button is leaving the article; both are held back until the next screen shows.
  const [leavingBy, setLeavingBy] = useState<LeaveKind | null>(null);
  const [leaving, startLeaving] = useTransition();
  useNavPending(leaving);
  // The last 読了 / スキップ / 未読に戻す that could not be saved; shown above the buttons.
  const [failed, setFailed] = useState<LeaveKind | null>(null);
  const leftInbox = useLeftInbox();
  function neighbor(step: 1 | -1) {
    if (!listIds) return undefined;
    const i = listIds.indexOf(article.id);
    return i < 0 ? (step === 1 ? listIds[0] : undefined) : listIds[i + step];
  }
  /**
   * Saves with `save` and then opens `whereTo()`, as one transition: `leaving` stays true until
   * the next screen shows, so a second press (or e / s) does nothing meanwhile. Resolves to
   * whether it was saved (false also when another one is already running). A failed save keeps
   * the article, shows a message above the buttons and lets them be pressed again.
   */
  function run(kind: LeaveKind, save: () => Promise<void>, whereTo: () => Promise<string>): Promise<boolean> {
    if (leaving) return Promise.resolve(false);
    setLeavingBy(kind);
    setFailed(null);
    const wide = isWide();
    return new Promise((resolve) =>
      startLeaving(async () => {
        try {
          await save();
        } catch (e) {
          console.error(e);
          setFailed(kind);
          resolve(false);
          return;
        }
        // Read cards leave the list to the right, skipped ones to the left, with a toast to undo.
        // Phones fetch the list again on the way back, without the card: a copy of it leaves there.
        if (kind !== "restore") leftInbox(article.id, kind, { refetched: !wide });
        // Saved: from here on the screen must move on, so it matches the database.
        const href = await whereTo().catch(() => inboxHref);
        router.push(href);
        // Drops the card from the list beside the article (see the note in lib/actions.ts), once
        // it has left there.
        if (wide && kind !== "restore") refreshAfterLeave(router);
        else router.refresh();
        resolve(true);
      }),
    );
  }

  /** 読了 / スキップ, then the next article beside the list (`split` and up) or the list. */
  function leave(kind: "read" | "skip"): Promise<boolean> {
    const wide = isWide();
    // Until the list has arrived after a direct load, the next article is not known.
    if (wide && listIds === null) return Promise.resolve(false);
    const planned = wide ? neighbor(1) : undefined;
    return run(
      kind,
      () => (kind === "read" ? markRead : skipArticle)(article.id),
      async () => {
        let next = planned;
        // Past the last loaded card, the next unread may still be behind 「もっと見る」.
        // If that lookup fails, the list (with its empty state beside it) is shown instead.
        if (wide && next === undefined) next = (await nextInboxArticle(search, listIds ?? [])) ?? undefined;
        return next === undefined ? inboxHref : `/articles/${next}${search}`;
      },
    );
  }

  function restore(): Promise<boolean> {
    return run("restore", () => restoreArticle(article.id), async () => inboxHref);
  }

  // PC shortcuts: j / k next / previous article, e read, s skip. Typing is left alone.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      if (isTyping(e) || !isWide()) return;
      if (e.key === "j" || e.key === "k") {
        const id = neighbor(e.key === "j" ? 1 : -1);
        if (id !== undefined) router.push(`/articles/${id}${search}`);
      } else if (e.key === "e" && !done) {
        void leave("read");
      } else if (e.key === "s" && !done) {
        void leave("skip");
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const summaryFailed =
    !streaming && msgs.length > 0 && msgs.every((m) => m.id < 0) && msgs.at(-1)?.content.includes("エラー");

  const chatInput = (
    <form onSubmit={submit} className="flex items-end gap-2">
      <textarea
        ref={inputRef}
        onChange={(e) => setHasInput(e.target.value.trim() !== "")}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter sends on a keyboard; plain Enter keeps adding lines.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) submit(e);
        }}
        rows={1}
        placeholder="質問や感想を書く"
        className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base lg:min-h-20"
      />
      <button
        disabled={streaming || !hasInput}
        className="h-11 rounded-xl bg-accent px-4 text-white disabled:opacity-50"
      >
        送信
      </button>
    </form>
  );

  const busy = (kind: LeaveKind) => leaving && leavingBy === kind;
  // The button that was not pressed fades while the other one runs.
  const held = (kind: LeaveKind) => (leaving && leavingBy !== kind ? "opacity-50" : "");
  // `waiting`: the buttons beside a list that is still loading, which read as not pressable yet.
  const actions = (waiting: boolean) => (
    <div className="flex flex-col gap-2">
      {failed && !leaving && (
        <p role="alert" className="text-center text-xs text-accent">
          保存できませんでした。もう一度押してください
        </p>
      )}
      {done ? (
        <div className="flex gap-2">
          <BusyButton
            onClick={() => void restore()}
            busy={busy("restore")}
            disabled={leaving}
            className={`h-11 flex-1 rounded-xl border border-line bg-surface text-sm ${held("restore")}`}
          >
            未読に戻す
          </BusyButton>
        </div>
      ) : (
        <div className="flex gap-2">
          <BusyButton
            onClick={() => void leave("skip")}
            busy={busy("skip")}
            disabled={leaving || waiting}
            className={`h-11 rounded-xl border border-line bg-surface px-4 text-sm text-muted ${waiting ? "opacity-50" : held("skip")}`}
          >
            スキップ
          </BusyButton>
          <BusyButton
            onClick={() => void leave("read")}
            busy={busy("read")}
            disabled={leaving || waiting}
            className={`h-11 flex-1 rounded-xl bg-accent text-sm font-medium text-white ${waiting ? "opacity-50" : held("read")}`}
          >
            読了にする
          </BusyButton>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh pb-36 split:flex split:min-h-0 split:min-w-0 split:flex-1 split:pb-0">
      {/* Beside the list (`split` and up) the article scrolls on its own, apart from the list and the chat. */}
      <div className="split:min-w-0 split:flex-1 split:overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4 lg:max-w-3xl lg:px-8">
            <Link href={done ? "/read" : inboxHref} className="pressable py-1 pr-2 text-muted" aria-label="戻る">
              ←
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-2xl px-4 lg:max-w-3xl lg:px-8">
          <main className="min-w-0 pt-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <FolderBadge name={article.folder} />
              <span>{article.source}</span>
              <span className="truncate">{hostname(article.url)}</span>
              {article.charCount > 0 && <span>{readingMinutes(article.charCount)}分</span>}
              {done && <span className="text-accent">読了</span>}
            </div>
            <h1 className="mt-1 text-xl font-bold leading-snug lg:text-2xl">{article.titleJa ?? article.title}</h1>
            {foreign && article.titleJa && article.titleJa !== article.title && (
              <p className="mt-1 text-sm leading-snug text-muted">{article.title}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-accent underline underline-offset-2"
              >
                元記事を開く ↗
              </a>
              {article.feedId !== null && (
                <FeedPause key={article.id} feedId={article.feedId} enabled={article.feedEnabled} source={article.source} />
              )}
            </div>

            {done && (article.learning || article.memo) && <NoteCard article={article} />}

            <div>
              {canTranslate && (
                <div className="mt-4 inline-flex rounded-full border border-line bg-surface p-1 text-xs">
                  {(["ja", "original"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setBodyLang(l)}
                      className={`rounded-full px-3 py-1 ${bodyLang === l ? "bg-text text-bg" : "text-muted"}`}
                    >
                      {l === "ja" ? "日本語で読む" : "原文"}
                    </button>
                  ))}
                </div>
              )}
              {canTranslate && (
                <div className={bodyLang === "ja" ? "" : "hidden"}>
                  <Translation articleId={article.id} initial={article.contentJa} />
                </div>
              )}
              <div className={bodyLang === "original" ? "" : "hidden"}>
              {article.contentHtml ? (
                <div className="prose-read mt-5 lg:max-w-[42em]" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
              ) : (
                <div className="mt-5 rounded-xl border border-line bg-surface p-4 text-sm">
                  <p className="text-muted">本文を取得できませんでした。元記事を開いて読んでください。</p>
                  {article.excerpt && <p className="mt-2">{article.excerpt}</p>}
                </div>
              )}
              </div>
            </div>

            <div className="sticky bottom-0 mt-8 hidden gap-2 border-t border-line bg-bg/95 py-3 backdrop-blur split:flex">
              <button
                onClick={() => setChatOpen(true)}
                className="pressable h-11 rounded-xl border border-line bg-surface px-4 text-sm xl:hidden"
              >
                <span className="font-medium text-accent">AI</span> と話す
              </button>
              <div className="flex-1">{actions(listIds === null)}</div>
            </div>
          </main>
        </div>
      </div>

      <aside
        aria-label="AI と話す"
        className={`${chatOpen ? "flex" : "hidden"} fixed inset-x-0 bottom-0 z-30 h-[80dvh] min-w-0 flex-col rounded-t-2xl border-t border-line bg-bg px-4 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.25)] split:inset-x-auto split:top-0 split:right-0 split:h-dvh split:w-[420px] split:rounded-none split:border-t-0 split:border-l split:pl-6 split:pr-[calc(1rem+env(safe-area-inset-right))] split:shadow-[-8px_0_30px_rgba(0,0,0,0.25)] xl:static xl:z-auto xl:flex xl:pr-4 xl:h-auto xl:w-[380px] xl:shrink-0 xl:shadow-none`}
      >
        <div className="flex items-center justify-between py-3 xl:hidden">
          <p className="text-sm font-bold">AI と話す</p>
          <button onClick={() => setChatOpen(false)} className="px-2 py-1 text-sm text-muted">
            閉じる
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2 split:py-4 split:pr-1">
          <p className="hidden text-xs font-medium tracking-wide text-muted xl:block">AI と話す</p>
          {msgs.length === 0 && !streaming && (
            <div className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
              <p>下の入力欄から、質問や感想をそのまま送れます。記事の3行要約と論点、考えるきっかけになる問いがほしいときはこちら。</p>
              <button
                onClick={startSummary}
                className="mt-3 rounded-full bg-accent px-4 py-2 text-white"
              >
                要約してもらう
              </button>
            </div>
          )}
          {msgs.map((m) =>
            m.role === "assistant" ? (
              <div key={m.id} className="rounded-xl border border-line bg-surface p-4">
                {m.content ? (
                  <Markdown text={m.content} className="prose-sm" />
                ) : (
                  <p className="animate-pulse text-sm text-muted">考えています…</p>
                )}
              </div>
            ) : (
              <div
                key={m.id}
                className="ml-8 self-end whitespace-pre-wrap rounded-xl bg-accent-soft px-4 py-3 text-[0.95rem]"
              >
                {m.content}
              </div>
            ),
          )}
          {summaryFailed && (
            <button
              onClick={startSummary}
              className="self-center rounded-full border border-line bg-surface px-4 py-2 text-sm"
            >
              要約をもう一度試す
            </button>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-line py-3">{chatInput}</div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 backdrop-blur pb-[env(safe-area-inset-bottom)] split:hidden">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-2">
          <button
            onClick={() => setChatOpen(true)}
            className="pressable flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-sm text-muted"
          >
            <span className="font-medium text-accent">AI</span>
            {msgs.length > 0 ? "対話の続きを開く" : "AI に質問する"}
          </button>
          {actions(false)}
        </div>
      </div>

      {chatOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 xl:hidden" onClick={() => setChatOpen(false)} />
      )}

    </div>
  );
}

/** Stops or resumes fetching the article's site, after an inline confirmation. Unread articles stay. */
function FeedPause({ feedId, enabled, source }: { feedId: number; enabled: boolean; source: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  useNavPending(pending);
  const router = useRouter();
  const set = (next: boolean) =>
    startTransition(async () => {
      await setArticleFeedEnabled(feedId, next);
      router.refresh();
      setConfirming(false);
    });

  if (!enabled) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        このサイトは取得を止めています
        <button
          onClick={() => set(true)}
          disabled={pending}
          className="rounded-full border border-line px-3 py-1 text-xs text-text disabled:opacity-50"
        >
          再開する
        </button>
      </span>
    );
  }
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="py-1 text-xs text-muted underline underline-offset-2">
        このサイトの取得を止める
      </button>
    );
  }
  return (
    <div role="group" aria-label="取得を止める確認" className="w-full rounded-xl border border-line bg-surface p-3 text-sm">
      <p className="break-words">「{source}」の取得を止めますか? 未読の記事は残ります</p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-full border border-line px-3 py-1.5 text-sm text-muted"
        >
          やめる
        </button>
        <button
          onClick={() => set(false)}
          disabled={pending}
          className="rounded-full border border-line px-3 py-1.5 text-sm text-accent disabled:opacity-50"
        >
          止める
        </button>
      </div>
    </div>
  );
}

/** The Japanese walkthrough of a foreign article, streamed and stored on first view. */
function Translation({ articleId, initial }: { articleId: number; initial: string | null }) {
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<"loading" | "done" | "error">(initial ? "done" : "loading");
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);

  useEffect(() => {
    if (initial || ran.current === attempt) return;
    ran.current = attempt;
    setText("");
    setState("loading");
    (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/translate`, { method: "POST" });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setText(full);
        }
        setState(full.includes("(日本語にまとめられませんでした") ? "error" : "done");
      } catch {
        setState("error");
      }
    })();
  }, [articleId, initial, attempt]);

  return (
    <div className="mt-4">
      {text && <Markdown text={text} className="lg:max-w-[42em]" />}
      {state === "loading" && (
        <p className="mt-3 animate-pulse text-sm text-muted">{text ? "まとめています…" : "日本語でまとめています…"}</p>
      )}
      {state === "error" && (
        <button onClick={() => setAttempt((n) => n + 1)} className="mt-3 text-sm text-accent underline">
          やり直す
        </button>
      )}
    </div>
  );
}

function NoteCard({ article }: { article: ArticleProps }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [learning, setLearning] = useState(article.learning ?? "");
  const [memo, setMemo] = useState(article.memo ?? "");
  if (editing) {
    return (
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <NoteFields learning={learning} memo={memo} setLearning={setLearning} setMemo={setMemo} />
        <button
          onClick={async () => {
            await updateNote(article.id, learning, memo);
            router.refresh();
            setEditing(false);
          }}
          className="self-end rounded-full bg-accent px-4 py-1.5 text-sm text-white"
        >
          保存
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-line bg-accent-soft/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{learning}</p>
        <button onClick={() => setEditing(true)} className="shrink-0 text-xs text-muted">
          編集
        </button>
      </div>
      {memo && <Markdown text={memo} className="prose-sm mt-2" />}
    </div>
  );
}

function NoteFields(p: {
  learning: string;
  memo: string;
  setLearning: (v: string) => void;
  setMemo: (v: string) => void;
}) {
  return (
    <>
      <label className="text-xs text-muted">学び(1行)</label>
      <input
        defaultValue={p.learning}
        onChange={(e) => p.setLearning(e.target.value)}
        className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
      />
      <label className="mt-1 text-xs text-muted">メモ</label>
      <textarea
        defaultValue={p.memo}
        onChange={(e) => p.setMemo(e.target.value)}
        rows={7}
        className="rounded-lg border border-line bg-bg px-3 py-2 text-[0.95rem] leading-relaxed"
      />
    </>
  );
}
