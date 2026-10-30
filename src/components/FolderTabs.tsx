import { Chip, ChipRow } from "@/components/ChipRow";
import type { Bucket } from "@/lib/board";
import { inboxQuery } from "@/lib/inbox";

/** The folder tabs with their unread counts; `selected` is a folder id, null (未分類) or "all". */
export function FolderTabs({
  folders,
  buckets,
  selected,
  a,
}: {
  folders: { id: number; name: string }[];
  buckets: Bucket[];
  selected: number | null | "all";
  a?: string; // 既読を含む stays on when the tab changes
}) {
  const sum = (id: number | null) => buckets.filter((b) => b.folderId === id).reduce((t, b) => t + b.n, 0);
  const unfiled = sum(null);
  return (
    <nav aria-label="フォルダ">
      <ChipRow>
        <Chip query={inboxQuery({ a })} label="すべて" count={buckets.reduce((t, b) => t + b.n, 0)} on={selected === "all"} />
        {folders.map((f) => (
          <Chip key={f.id} query={inboxQuery({ f: String(f.id), a })} label={f.name} count={sum(f.id)} on={selected === f.id} />
        ))}
        {(unfiled > 0 || selected === null) && (
          <Chip query={inboxQuery({ f: "none", a })} label="未分類" count={unfiled} on={selected === null} />
        )}
      </ChipRow>
    </nav>
  );
}
