"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { articleIdOf, noteScreen, screenOf } from "@/lib/track";

/**
 * Follows the screen for the activity log (lib/track.ts) and sends `open` for each article
 * opened. In the root layout, so it also sees the 読了 and フィード screens an article may be
 * opened from. Keyed on the article id, not the URL: a chip or 「もっと見る」 beside the article
 * changes only the URL.
 */
export function ActivityLog() {
  const pathname = usePathname();
  const screen = screenOf(pathname, useSearchParams());
  const articleId = articleIdOf(pathname);
  useEffect(() => noteScreen(screen, articleId), [screen, articleId]);
  return null;
}
