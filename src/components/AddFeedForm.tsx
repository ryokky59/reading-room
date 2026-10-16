"use client";

import { useActionState } from "react";
import { addFeed, type ActionState } from "@/lib/actions";

export function AddFeedForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addFeed, {});
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <label htmlFor="feed-url" className="text-sm font-medium">
        サイトを追加
      </label>
      <input
        id="feed-url"
        name="url"
        type="url"
        inputMode="url"
        required
        placeholder="サイトか RSS の URL(https://…)"
        className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
      />
      <input
        id="feed-name"
        name="name"
        placeholder="表示名(空ならサイト名を使います)"
        className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name="category" value="tech" defaultChecked /> Tech
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="category" value="business" /> Business
        </label>
        <button
          disabled={pending}
          className="ml-auto rounded-full bg-accent px-4 py-1.5 text-white disabled:opacity-60"
        >
          {pending ? "RSS を探しています…" : "追加する"}
        </button>
      </div>
      {state.error && <p className="text-sm text-accent">{state.error}</p>}
      {state.message && <p className="text-sm text-muted">{state.message}</p>}
    </form>
  );
}
