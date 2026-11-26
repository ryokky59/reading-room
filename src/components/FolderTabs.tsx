import { Chip, ChipRow } from "@/components/ChipRow";
import type { Bucket } from "@/lib/board";
import { inboxQuery } from "@/lib/inbox";

/** The folder tabs with their unread counts; `selected` is a folder id, null (未分類) or "all". */
export function FolderTabs({
  folders,
  buckets,
  selected,
  v,
  a,
}: {
  folders: { id: number; name: string }[];
  buckets: Bucket[];
  selected: number | null | "all";
  v?: "t"; // so does the timeline
  a?: string; // 既読を含む stays on when the tab changes
}) {
  const sum = (id: number | null) => buckets.filter((b) => b.folderId === id).reduce((t, b) => t + b.n, 0);
  const unfiled = sum(null);
  return (
    <nav aria-label="フォルダ">
      <ChipRow>
        <Chip query={inboxQuery({ v, a })} label="すべて" count={buckets.reduce((t, b) => t + b.n, 0)} on={selected === "all"} />
        {folders.map((f) => (
          <Chip key={f.id} query={inboxQuery({ f: String(f.id), v, a })} label={f.name} count={sum(f.id)} folder={String(f.id)} on={selected === f.id} />
        ))}
        {(unfiled > 0 || selected === null) && (
          <Chip query={inboxQuery({ f: "none", v, a })} label="未分類" count={unfiled} folder="none" on={selected === null} />
        )}
      </ChipRow>
    </nav>
  );
}
