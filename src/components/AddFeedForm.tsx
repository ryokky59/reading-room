"use client";

import { useActionState } from "react";
import { addFeed, type ActionState } from "@/lib/actions";

export function AddFeedForm({ folders }: { folders: { id: number; name: string }[] }) {
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
        <label className="flex min-w-0 items-center gap-2">
          フォルダ
          <select
            name="folderId"
            aria-label="追加先のフォルダ"
            defaultValue={folders[0]?.id ?? ""}
            className="min-w-0 rounded-lg border border-line bg-bg px-2 py-1.5 text-base"
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="">未分類</option>
          </select>
        </label>
        <button
          disabled={pending}
          className="pressable ml-auto rounded-full bg-accent px-4 py-1.5 text-white disabled:opacity-60"
        >
          {pending ? "RSS を探しています…" : "追加する"}
        </button>
      </div>
      {state.error && <p className="text-sm text-accent">{state.error}</p>}
      {state.message && <p className="text-sm text-muted">{state.message}</p>}
    </form>
  );
}
