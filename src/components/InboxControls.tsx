"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { addArticle, fetchNow, type ActionState } from "@/lib/actions";

export function InboxControls() {
  const router = useRouter();
  // A failed request shows a message under the button instead of the error page, so it can be
  // pressed again.
  const [fetchState, fetchAction, fetching] = useActionState<ActionState>(async () => {
    try {
      const state = await fetchNow();
      router.refresh(); // See the note in lib/actions.ts.
      return state;
    } catch (e) {
      console.error(e);
      // The fetch takes about a minute, and a phone that locks or leaves Safari meanwhile can drop
      // the connection while the server finishes and saves the articles. Refresh so they show.
      router.refresh();
      // fetch() rejects with a TypeError when the connection fails ("Failed to fetch" in Chrome,
      // "Load failed" in Safari). An error the server sent back reaches here as a plain Error.
      if (e instanceof TypeError) {
        return { error: "通信が切れました。取得が終わっていれば一覧に出ています。出ていなければもう一度押してください" };
      }
      return { error: "取得できませんでした。もう一度押してください" };
    }
  }, {});
  const [addState, addAction, adding] = useActionState<ActionState, FormData>(async (prev, form) => {
    try {
      return await addArticle(prev, form);
    } catch (e) {
      unstable_rethrow(e); // The redirect to the added article.
      console.error(e);
      return { error: "記事を追加できませんでした。もう一度押してください" };
    }
  }, {});
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={fetchAction}>
          <button
            disabled={fetching}
            className="pressable rounded-full border border-line bg-surface px-4 py-2 text-sm disabled:opacity-60"
          >
            {fetching ? "取得中…(1分ほど)" : "今すぐ取得"}
          </button>
        </form>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="pressable rounded-full border border-line bg-surface px-4 py-2 text-sm"
        >
          URL を追加
        </button>
      </div>
      {fetchState.message && <p className="text-sm text-muted">{fetchState.message}</p>}
      {fetchState.error && (
        <p role="alert" className="text-sm text-accent">
          {fetchState.error}
        </p>
      )}
      {showAdd && (
        <form action={addAction} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <input
            name="url"
            type="url"
            inputMode="url"
            required
            // Controlled, so the URL stays after a failed request instead of being reset with the form.
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
          />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs text-muted">「未分類」に入ります</span>
            <button
              disabled={adding}
              className="ml-auto rounded-full bg-accent px-4 py-1.5 text-white disabled:opacity-60"
            >
              {adding ? "取得中…" : "追加して読む"}
            </button>
          </div>
          {addState.error && <p className="text-sm text-accent">{addState.error}</p>}
        </form>
      )}
    </div>
  );
}
