"use client";

import { moveFeed } from "@/lib/actions";

/** Moves a feed to another folder as soon as one is picked. */
export function FeedFolderSelect({
  feedId,
  feedName,
  folderId,
  folders,
}: {
  feedId: number;
  feedName: string;
  folderId: number | null;
  folders: { id: number; name: string }[];
}) {
  return (
    <form action={moveFeed.bind(null, feedId)} className="mt-1.5">
      <select
        name="folderId"
        defaultValue={folderId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label={`${feedName} のフォルダ`}
        className="max-w-full rounded-lg border border-line bg-bg px-2 py-1 text-sm"
      >
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value="">未分類</option>
      </select>
    </form>
  );
}
