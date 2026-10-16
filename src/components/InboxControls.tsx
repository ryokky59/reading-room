"use client";

import { useActionState, useState } from "react";
import { addArticle, fetchNow, type ActionState } from "@/lib/actions";

export function InboxControls() {
  const [fetchState, fetchAction, fetching] = useActionState<ActionState>(fetchNow, {});
  const [addState, addAction, adding] = useActionState<ActionState, FormData>(addArticle, {});
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={fetchAction}>
          <button
            disabled={fetching}
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm disabled:opacity-60"
          >
            {fetching ? "取得中…(1分ほど)" : "今すぐ取得"}
          </button>
        </form>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-full border border-line bg-surface px-4 py-2 text-sm"
        >
          URL を追加
        </button>
      </div>
      {fetchState.message && <p className="text-sm text-muted">{fetchState.message}</p>}
      {showAdd && (
        <form action={addAction} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <input
            name="url"
            type="url"
            inputMode="url"
            required
            placeholder="https://…"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
          />
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="category" value="tech" defaultChecked /> Tech
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="category" value="business" /> Business
            </label>
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
