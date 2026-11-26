"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { moveFeed } from "@/lib/actions";

type FolderOption = { id: number; name: string };

// The folder list is sent once for the whole page, not once per feed row (#130).
const FoldersContext = createContext<FolderOption[]>([]);

export function FeedFoldersProvider({ folders, children }: { folders: FolderOption[]; children: ReactNode }) {
  return <FoldersContext.Provider value={folders}>{children}</FoldersContext.Provider>;
}

/**
 * Moves a feed to another folder as soon as one is picked.
 *
 * Until the menu is touched it holds only the current folder: every row offering every folder made
 * /feeds grow as feeds × folders (#130). The first pointerdown, focus or key fills in the rest,
 * before the picker opens; the current option keeps its key, so it stays the selected one.
 */
export function FeedFolderSelect({
  feedId,
  feedName,
  folderId,
}: {
  feedId: number;
  feedName: string;
  folderId: number | null;
}) {
  const folders = useContext(FoldersContext);
  const [full, setFull] = useState(false);
  const fill = () => setFull(true);
  // A folder that no longer exists shows the feed under 未分類, as the page does.
  const current = folders.find((f) => f.id === folderId);
  const shown = full ? folders : current ? [current] : [];
  return (
    <form action={moveFeed.bind(null, feedId)} className="mt-1.5">
      <select
        name="folderId"
        defaultValue={current?.id ?? ""}
        onPointerDown={fill}
        onFocus={fill}
        onKeyDown={fill}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label={`${feedName} のフォルダ`}
        className="max-w-full rounded-lg border border-line bg-bg px-2 py-1 text-base"
      >
        {shown.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        {(full || !current) && (
          <option key="none" value="">
            未分類
          </option>
        )}
      </select>
    </form>
  );
}
