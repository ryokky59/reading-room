"use client";

import { useState } from "react";
import { deleteFolder, moveFolder, renameFolder } from "@/lib/actions";

/** A folder's heading with reorder buttons and an edit panel for rename / delete. */
export function FolderHeader({
  id,
  name,
  feedCount,
  first,
  last,
}: {
  id: number;
  name: string;
  feedCount: number;
  first: boolean;
  last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const close = () => setEditing(false);
  return (
    <div className="mb-2 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold">
          {name} <span className="font-normal text-muted">{feedCount}</span>
        </h2>
        <form action={moveFolder.bind(null, id, -1)}>
          <button
            disabled={first}
            aria-label={`${name} を上へ`}
            className="pressable h-8 w-8 rounded-full border border-line text-sm disabled:opacity-30"
          >
            ↑
          </button>
        </form>
        <form action={moveFolder.bind(null, id, 1)}>
          <button
            disabled={last}
            aria-label={`${name} を下へ`}
            className="pressable h-8 w-8 rounded-full border border-line text-sm disabled:opacity-30"
          >
            ↓
          </button>
        </form>
        <button
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          aria-label={`${name} を編集`}
          className={`pressable h-8 rounded-full border border-line px-3 text-xs ${editing ? "bg-text text-bg" : ""}`}
        >
          編集
        </button>
      </div>
      {editing && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
          <form
            action={async (form) => {
              await renameFolder(id, form);
              close();
            }}
            className="flex gap-2"
          >
            <input
              name="name"
              required
              defaultValue={name}
              aria-label="フォルダ名"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-base"
            />
            <button className="pressable shrink-0 rounded-full bg-accent px-3 py-1.5 text-sm text-white">名前を変更</button>
          </form>
          <form
            action={async () => {
              await deleteFolder(id);
              close();
            }}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-xs text-muted">中のフィードは「未分類」に移ります</span>
            <button className="pressable shrink-0 rounded-full border border-line px-3 py-1.5 text-sm text-accent">
              フォルダを削除
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
