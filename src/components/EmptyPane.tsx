"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isTyping, isWide, useInboxIds } from "./InboxShell";

/** The PC article pane when no article is open; `j` opens the first one in the list. */
export function EmptyPane({ query }: { query: string }) {
  const router = useRouter();
  const ids = useInboxIds();
  const first = ids?.[0];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "j" || first === undefined || isTyping(e) || !isWide()) return;
      router.push(`/articles/${first}${query}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, query, router]);

  return (
    <div className="hidden flex-1 items-center justify-center p-8 text-center text-sm text-muted split:flex">
      {ids === null ? null : first === undefined ? (
        <p>未読の記事はありません。</p>
      ) : (
        <p>
          一覧から記事を選ぶと、ここで読めます。
          <br />
          <kbd>j</kbd> / <kbd>k</kbd> で次 / 前の記事、<kbd>e</kbd> で読了、<kbd>s</kbd> でスキップ。
        </p>
      )}
    </div>
  );
}
