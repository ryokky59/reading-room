"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { markSeen, unmarkSeen } from "@/lib/actions";
import { BusyButton } from "./BusyButton";
import { FAILED, isBoard, isWide, useArticleOpen, useScrolledSeen, watchLayout } from "./InboxShell";
import { useNavPending } from "./NavPending";
import { useToast } from "./Toast";

// A row counts as scrolled past once it has been above the top edge for this long,
const DWELL_MS = 500;
// and is saved once no other row has followed it for this long: one request for a flick.
const SAVE_MS = 1000;
// Nothing counts for this long after the list shows (a load, coming back from an article): the
// page is still being put where it was, and those jumps are not the owner scrolling.
const SETTLE_MS = 1000;
// What markSeen and unmarkSeen take at once.
const MAX_IDS = 1000;

type Line = { after: number; count: number; busy: boolean; undo: () => void };

const LineContext = createContext<Line | null>(null);

/**
 * 「ここまで既読 · N 件 [元に戻す]」, after the last row its list marked by scrolling. Put one after
 * each row (InboxItem and BoardRow do); it shows after row `after` only.
 */
export function SeenLine({ after, className = "" }: { after: number; className?: string }) {
  const line = useContext(LineContext);
  if (line?.after !== after) return null;
  const rule = <span aria-hidden="true" className="h-px min-w-2 flex-1 border-t border-dashed border-muted/60" />;
  return (
    // Not a list item to assistive technology (or to a count of the cards): it is a note between them.
    <li role="presentation" data-seen-line="" className={`flex items-center gap-2 text-xs text-muted ${className}`}>
      {rule}
      <span className="shrink-0">ここまで既読 · {line.count} 件</span>
      <BusyButton type="button" busy={line.busy} onClick={line.undo} className="shrink-0 py-1 text-accent disabled:opacity-60">
        元に戻す
      </BusyButton>
      {rule}
    </li>
  );
}

/**
 * The `ul` of a feed's list (`mode` "list") or of a Board column ("column"). Rows that scroll up
 * past the top edge of what they scroll in are marked as seen: they fade at once and the unread
 * counts drop (useUnread in InboxShell), without a refresh, and stay in place (lib/opened.ts).
 * The line after the last of them undoes them all.
 *
 * A list scrolls in its pane on wide screens and with the window on phones, where the edge is
 * the bottom of the sticky header. A column scrolls only while the Board shows as columns
 * (`board:`); stacked, it shows three rows and marks nothing.
 *
 * The edge is found by measuring on scroll, not with an IntersectionObserver: that reports a row
 * only when it is caught crossing the edge, and a flick moves rows past it between two frames.
 *
 * `rows` are the rows in order, with whether the server has them as seen.
 */
export function SeenOnScroll({
  mode,
  feed,
  folder,
  rows,
  children,
  ...props
}: {
  /** null for a list that marks nothing: a plain `ul`. */
  mode: "list" | "column" | null;
  /** The feed and its folder, as in Scrolled (InboxShell). */
  feed: string;
  folder: string;
  rows: { id: number; seen: boolean }[];
} & React.ComponentProps<"ul">) {
  const ref = useRef<HTMLUListElement>(null);
  const owner = useId();
  const shell = useScrolledSeen();
  const { scrolled, opened } = shell;
  const toast = useToast();
  const router = useRouter();
  const open = useArticleOpen();
  const [layout, setLayout] = useState(0);
  useEffect(() => watchLayout(() => setLayout((n) => n + 1)), []);

  // What the handlers below read when they run, which is long after the render that made them.
  const live = useRef({ rows, shell, toast, feed, folder });
  useEffect(() => {
    live.current = { rows, shell, toast, feed, folder };
  });

  // Kept across refreshes of the list, which run the effect below again.
  const state = useRef({
    /** Whether each row was above the edge when last measured. */
    above: new Map<number, boolean>(),
    /** When each row went above the edge, until it has stayed there for DWELL_MS. */
    crossed: new Map<number, number>(),
    /** Rows faded and waiting to be saved. */
    queue: new Set<number>(),
    /** Nothing counts before this (SETTLE_MS). */
    activeAt: 0,
    /** What the list last showed as (article open or not, the layout), to tell when it shows anew. */
    shownAs: "",
    /** Every row saved so far, in order; 「元に戻す」 reads the ones saved while it waits. */
    saved: [] as number[],
    dwellTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    saveTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** The saves so far; 「元に戻す」 waits for them. */
    saving: Promise.resolve(),
    measure: () => {},
  });

  const save = () => {
    const s = state.current;
    clearTimeout(s.saveTimer);
    const ids = [...s.queue].slice(0, MAX_IDS);
    for (const id of ids) s.queue.delete(id);
    if (s.queue.size > 0) s.saveTimer = setTimeout(save, 0);
    if (ids.length === 0) return;
    const run = async () => {
      const { shell, toast } = live.current;
      try {
        // Only the rows it marked: one seen or read elsewhere meanwhile stays faded, and out of 「元に戻す」.
        const saved = await markSeen(ids);
        s.saved.push(...saved);
        shell.settleScrolled(saved);
      } catch (e) {
        console.error(e);
        shell.dropScrolled(ids);
        // As if they had not crossed yet: the next scroll finds them above the edge and tries again.
        for (const id of ids) s.above.set(id, false);
        toast.fail("保存できませんでした");
      }
    };
    s.saving = s.saving.then(run);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const key = rows.map((r) => r.id).join(",");
  useEffect(() => {
    const ul = ref.current;
    const s = state.current;
    if (!ul || mode === null || (mode === "column" && !isBoard())) return;
    const pane = mode === "column" ? ul : isWide() ? ul.closest<HTMLElement>("[data-list-pane]") : null;
    const header = pane ? null : document.querySelector<HTMLElement>("[data-app-header]");
    const edge = () => (pane ? pane.getBoundingClientRect().top : Math.max(0, header?.getBoundingClientRect().bottom ?? 0));
    const items = [...ul.querySelectorAll<HTMLElement>(":scope > li[data-article], :scope > li[data-row]")];

    const ripen = () => {
      s.measure();
      const now = performance.now();
      const { rows, shell, feed, folder } = live.current;
      const ripe = [...s.crossed].filter(([, at]) => now - at >= DWELL_MS).map(([id]) => id);
      for (const id of ripe) s.crossed.delete(id);
      // Not the rows that are seen already, by the server's word, by being opened or by an earlier pass.
      const fresh = ripe.filter(
        (id) => rows.some((r) => r.id === id && !r.seen) && !shell.opened.has(id) && !shell.scrolled.has(id),
      );
      if (fresh.length > 0) {
        for (const id of fresh) s.queue.add(id);
        shell.addScrolled(fresh, { feed, folder, owner });
        clearTimeout(s.saveTimer);
        s.saveTimer = setTimeout(() => saveRef.current(), SAVE_MS);
      }
      wait();
    };
    const wait = () => {
      clearTimeout(s.dwellTimer);
      if (s.crossed.size === 0) return;
      const first = Math.min(...s.crossed.values());
      s.dwellTimer = setTimeout(ripen, Math.max(0, first + DWELL_MS - performance.now()));
    };
    s.measure = () => {
      // Hidden under an article on phones (or under the feed list beside one): nothing to measure.
      if (ul.getClientRects().length === 0) return;
      const top = edge();
      const now = performance.now();
      for (const li of items) {
        const rect = li.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // a card that has left
        const id = Number(li.dataset.article ?? li.dataset.row);
        const above = rect.bottom <= top;
        const was = s.above.get(id);
        s.above.set(id, above);
        if (!above) s.crossed.delete(id);
        // Only a row seen going up past the edge: not one that was above it when the list showed.
        else if (was === false && now >= s.activeAt && !s.crossed.has(id)) s.crossed.set(id, now);
      }
      wait();
    };

    // Not when only the rows changed (「もっと見る」, a card that left): the owner may be scrolling.
    const shownAs = `${open}:${layout}`;
    if (s.shownAs !== shownAs) s.activeAt = performance.now() + SETTLE_MS;
    s.shownAs = shownAs;
    s.measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(s.measure);
    };
    const target = pane ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(s.dwellTimer);
      s.measure = () => {};
    };
  }, [key, mode, layout, open, owner]);

  // Leaving the list does not lose the rows waiting to be saved.
  useEffect(() => () => saveRef.current(), []);

  // Behind the line: what this list saved and nothing has taken back. A row opened since is seen
  // for that, too, and 「元に戻す」 leaves it.
  const batch = useMemo(
    () => [...scrolled].filter(([id, row]) => row.owner === owner && row.saved && !opened.has(id)).map(([id]) => id),
    [scrolled, opened, owner],
  );
  const after = rows.findLast((r) => batch.includes(r.id))?.id;
  const [busy, startUndo] = useTransition();
  useNavPending(busy);
  const undo = () =>
    startUndo(async () => {
      const s = state.current;
      const { shell, toast } = live.current;
      // The rows still waiting go back without being saved.
      clearTimeout(s.saveTimer);
      shell.dropScrolled([...s.queue]);
      s.queue.clear();
      s.crossed.clear();
      // A save on its way finishes first, and its rows go back with the rest.
      const from = s.saved.length;
      await s.saving;
      const ids = [...new Set([...batch, ...s.saved.slice(from)])];
      try {
        for (let i = 0; i < ids.length; i += MAX_IDS) await unmarkSeen(ids.slice(i, i + MAX_IDS));
      } catch (e) {
        console.error(e);
        toast.fail(FAILED);
        return;
      }
      shell.dropScrolled(ids);
      // The server may have these rows as seen by now (a refresh since); they come back unread.
      router.refresh();
    });
  const line = after === undefined ? null : { after, count: batch.length, busy, undo };

  return (
    <LineContext.Provider value={line}>
      <ul ref={ref} {...props}>
        {children}
      </ul>
    </LineContext.Provider>
  );
}
