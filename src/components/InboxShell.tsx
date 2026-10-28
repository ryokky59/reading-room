"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { restoreArticle, skipArticle } from "@/lib/actions";
import { Header } from "./Header";
import { useNavPending } from "./NavPending";
import { ToastProvider, useToast } from "./Toast";

// PCs and unfolded phones (the `split` variant in globals.css, 600px and up) read with the list
// and the article side by side; the chat joins them as a column from Tailwind `xl`.
// Narrower phones keep separate list and article screens. Keep this in sync with globals.css.
const WIDE = "(min-width: 600px)";

/** Whether the screen is wide enough for the list pane; read at event time. */
export function isWide() {
  return window.matchMedia(WIDE).matches;
}

/** Whether a key press is typing (an input, a textarea, a select or an IME) rather than a shortcut. */
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    e.isComposing ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
  );
}

type InboxNav = {
  /** Unread article ids in the order the list shows them; null until the list has rendered. */
  ids: number[] | null;
  setIds: (ids: number[]) => void;
};

const InboxNavContext = createContext<InboxNav>({ ids: null, setIds: () => {} });

/**
 * The order of the list pane, for opening the next / previous article. Cards leaving the list
 * are left out, though the list has not been refreshed yet.
 */
export function useInboxIds() {
  return useContext(InboxNavContext).ids;
}

/** Which way a list card leaves: スキップ to the left, 読了 to the right. */
export type LeaveDirection = "left" | "right";

// How long a card takes to slide out and close up (see [data-leaving] in globals.css).
const LEAVE_MS = 650;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Refreshes the router (see the note in lib/actions.ts) once a card that started leaving at
 * `since` has slid out and closed up: the refreshed list drops the card, which would cut its
 * motion short. Runs outside any transition, so nothing else waits for it.
 */
export function refreshAfterLeave(router: { refresh: () => void }, since = performance.now()) {
  const wait = reducedMotion() ? 0 : Math.max(0, since + LEAVE_MS - performance.now());
  setTimeout(() => router.refresh(), wait);
}

/**
 * A copy of a card taken as it starts leaving a list that is about to be refetched (phones go
 * back to the list with router.push, which brings the list without the card). It is shown
 * where the card was, before the card that followed it (`before`, null for the last card), so
 * the card can still be seen leaving.
 */
type Ghost = { html: string; className: string; before: number | null };

type LeavingCard = { dir: LeaveDirection; ghost?: Ghost };

type Leaving = {
  leaving: ReadonlyMap<number, LeavingCard>;
  /** The ids the list shows, leaving or not; null until the list has rendered. */
  listed: number[] | null;
  /** Starts a card leaving the list, or with null puts it back. */
  setLeaving: (id: number, card: LeavingCard | null) => void;
};

const LeavingContext = createContext<Leaving>({ leaving: new Map(), listed: null, setLeaving: () => {} });

/** Which way the card of article `id` is leaving the list, if it is. */
export function useLeaving(id: number) {
  return useContext(LeavingContext).leaving.get(id)?.dir;
}

const FAILED = "保存できませんでした。もう一度押してください";

/** Copies the card of article `id` from the page, to show as a Ghost after the list is refetched. */
function takeGhost(id: number): Ghost | undefined {
  const li = document.querySelector<HTMLLIElement>(`li[data-article="${id}"]`);
  if (!li || reducedMotion()) return undefined;
  let next = li.nextElementSibling;
  while (next && !next.matches("li[data-article]")) next = next.nextElementSibling;
  const before = next ? Number(next.getAttribute("data-article")) : null;
  return { html: li.innerHTML, className: li.className, before };
}

/**
 * Shows that an article was read or skipped: its card leaves the list (`done` is the action,
 * which may still be running) and a toast offers 「元に戻す」, which puts the article back in
 * the inbox. Only the latest toast can be undone. With `refetched`, the list is about to be
 * fetched again without the card, so a copy of the card is kept to leave in its place.
 */
export function useLeftInbox() {
  const { setLeaving } = useContext(LeavingContext);
  const toast = useToast();
  const router = useRouter();
  return useCallback(
    (id: number, kind: "read" | "skip", { done = Promise.resolve(), refetched = false } = {}) => {
      const dir = kind === "read" ? "right" : "left";
      setLeaving(id, { dir, ghost: refetched ? takeGhost(id) : undefined });
      // Called outside any transition, so the card shows again at once; the refresh then
      // puts it where the list has it.
      const undo = async () => {
        setLeaving(id, null);
        try {
          // The restore must not reach the server before the read / skip does.
          await done.catch(() => {});
          await restoreArticle(id);
        } catch (e) {
          console.error(e);
          setLeaving(id, { dir });
          toast.fail(FAILED, { owner: id, undo });
          return;
        }
        router.refresh();
      };
      toast.show(kind === "read" ? "読了にしました" : "スキップしました", { owner: id, undo });
    },
    [setLeaving, toast, router],
  );
}

/** The article id open next to the list, if any. */
function useOpenId() {
  const match = /^\/articles\/(\d+)/.exec(usePathname());
  return match ? Number(match[1]) : null;
}

/**
 * Holds the list pane and the page beside it. The list is a parallel route slot, so opening
 * another article swaps only `children`: the list keeps its scroll position and filter.
 */
export function InboxShell({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const [ids, setIds] = useState<number[] | null>(null);
  const [leaving, setLeavingMap] = useState<ReadonlyMap<number, LeavingCard>>(new Map());
  const setLeaving = useCallback((id: number, card: LeavingCard | null) => {
    setLeavingMap((m) => {
      if (!card && !m.has(id)) return m;
      const next = new Map(m);
      if (card) next.set(id, card);
      else next.delete(id);
      return next;
    });
  }, []);
  const syncIds = useCallback((ids: number[]) => {
    setIds(ids);
    // A card is gone for good once the refreshed list no longer has it; a ghost of it removes
    // itself once it has left (LeavingGhosts).
    setLeavingMap((m) => {
      const gone = [...m].filter(([id, card]) => !card.ghost && !ids.includes(id));
      if (gone.length === 0) return m;
      const next = new Map(m);
      for (const [id] of gone) next.delete(id);
      return next;
    });
  }, []);
  // A ghost that never got shown (the list was left meanwhile) must not show up later.
  useEffect(() => {
    const ghosts = [...leaving].filter(([, card]) => card.ghost).map(([id]) => id);
    if (ghosts.length === 0) return;
    const timer = setTimeout(() => {
      for (const id of ghosts) {
        setLeavingMap((m) => {
          if (!m.get(id)?.ghost) return m;
          const next = new Map(m);
          next.delete(id);
          return next;
        });
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [leaving]);
  const leavingValue = useMemo(() => ({ leaving, listed: ids, setLeaving }), [leaving, ids, setLeaving]);
  const shownIds = useMemo(() => ids && ids.filter((id) => !leaving.has(id)), [ids, leaving]);
  const open = useOpenId() !== null;
  usePhoneListScroll(open);
  useArticleUrlAfterListChange();
  return (
    <InboxNavContext.Provider value={{ ids: shownIds, setIds: syncIds }}>
      <LeavingContext.Provider value={leavingValue}>
        {/* Phones: bottom centre, and hidden over an article, whose buttons sit at the bottom.
            Beside an article (`split` and up): over the bottom of the list pane. */}
        <ToastProvider
          className={`${open ? "hidden split:block" : ""} pointer-events-none fixed z-40 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] split:right-auto split:left-[calc(1rem+env(safe-area-inset-left))] split:w-[15.5rem] lg:w-[18rem]`}
        >
          <div className="split:flex split:h-dvh split:flex-col">
            <Header active="inbox" className={open ? "hidden split:block" : undefined} panes />
            <div className="split:flex split:min-h-0 split:flex-1">
              {/* A role, not an element, so the list is not remounted when an article opens. */}
              {/* The safe-area insets (0 on PCs) keep the panes clear of a landscape iPhone's notch and corners. */}
              <div
                role={open ? "region" : "main"}
                aria-label={open ? "新着一覧" : undefined}
                className={`${open ? "hidden split:block" : ""} split:w-[calc(17.5rem+env(safe-area-inset-left))] lg:w-[calc(20rem+env(safe-area-inset-left))] split:shrink-0 split:overflow-y-auto split:overscroll-contain split:border-r split:border-line split:pl-[env(safe-area-inset-left)]`}
              >
                {list}
              </div>
              <div
                className={`${open ? "" : "hidden"} split:flex split:min-w-0 split:flex-1 split:pr-[env(safe-area-inset-right)]`}
              >
                {children}
              </div>
            </div>
          </div>
        </ToastProvider>
      </LeavingContext.Provider>
    </InboxNavContext.Provider>
  );
}

/**
 * Phones show the list and the article one at a time on the same window scroll. Remembers
 * where the list was when an article opens, starts the article at its top, and puts the list
 * back where it was on the way back (←, browser back, 読了 or スキップ). PCs scroll each pane
 * on their own, so this leaves them alone.
 */
function usePhoneListScroll(open: boolean) {
  // Where the list was when an article opened; null until one has opened in this shell.
  const listY = useRef<number | null>(null);
  // Layout effects run after Next.js has handled scroll for the page below, so these win.
  useLayoutEffect(() => {
    if (isWide()) return;
    if (open) {
      window.scrollTo(0, 0);
      return;
    }
    let frame = 0;
    const y = listY.current;
    if (y !== null) {
      window.scrollTo(0, y);
      // The browser may restore its own position after a back; put the list back once more.
      frame = requestAnimationFrame(() => {
        if (window.scrollY !== y) window.scrollTo(0, y);
      });
    }
    listY.current = window.scrollY;
    // Tracks the list only while it shows: the listener is gone before hiding the list for an
    // article shrinks the page and moves the window.
    const record = () => (listY.current = window.scrollY);
    window.addEventListener("scroll", record, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", record);
    };
  }, [open]);
}

/** Tells the shell which articles the list shows, in order. */
export function InboxNavSync({ ids }: { ids: number[] }) {
  const { setIds } = useContext(InboxNavContext);
  const key = ids.join(",");
  // Before paint, so a card's ghost (LeavingGhosts) shows in the same frame as the list without it.
  useLayoutEffect(() => {
    setIds(key ? key.split(",").map(Number) : []);
  }, [key, setIds]);
  return null;
}

/**
 * A link that changes what the list shows (a folder / site chip, 「もっと見る」). With an article
 * open beside the list (PCs; phones hide the list then) it goes to `/articles/<id>/list`, which
 * only the list pane has a page for: the list changes and the article pane keeps the open
 * article and its half-written chat message. See useArticleUrlAfterListChange for the URL.
 */
export function ListLink({ query, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { query: string }) {
  const openId = useOpenId();
  return <Link href={`${openId === null ? "/" : `/articles/${openId}/list`}${query}`} {...props} />;
}

/**
 * After a ListLink beside an article, puts the article's own URL with the new filter in place of
 * `/articles/<id>/list`. The list pane keeps what the list page showed (it has no page of its own
 * for an article URL, see @list/default.tsx), and the article picks up the filter for ←, 読了
 * and スキップ without being remounted, since only search params change for it. The URL can
 * then be reloaded or shared like any article URL.
 */
function useArticleUrlAfterListChange() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const match = /^\/articles\/(\d+)\/list$/.exec(pathname);
    if (match) router.replace(`/articles/${match[1]}${search ? `?${search}` : ""}`, { scroll: false });
  }, [pathname, search, router]);
}

/**
 * The list pane after an article URL is loaded directly (see @list/default.tsx). Phones show
 * no list beside the article, so the article does not wait for one. On PCs (or once the screen
 * becomes wide) this goes to `/articles/<id>/list` like a chip does: the list page fills the
 * pane, the article stays, and useArticleUrlAfterListChange puts the article URL back.
 */
export function ListAfterFullLoad() {
  const router = useRouter();
  const openId = useOpenId();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (openId === null) return;
    const media = window.matchMedia(WIDE);
    const load = () => {
      if (media.matches) router.replace(`/articles/${openId}/list${search ? `?${search}` : ""}`, { scroll: false });
    };
    load();
    media.addEventListener("change", load);
    return () => media.removeEventListener("change", load);
  }, [openId, search, router]);
  return (
    <div className="hidden px-4 pt-4 split:block" aria-busy="true">
      <ul className="grid gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="animate-pulse rounded-xl border border-line bg-surface p-4">
            <div className="h-3 w-1/3 rounded bg-line" />
            <div className="mt-3 h-4 w-11/12 rounded bg-line" />
            <div className="mt-2 h-4 w-2/3 rounded bg-line" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A list card, highlighted while its article is open beside the list. It sinks while its link is
 * held, and its link's LinkPending outlines it until the article starts to show. After 読了 or
 * スキップ it slides out, closes up and stays hidden until the refreshed list drops it.
 */
export function InboxItem({ id, children }: { id: number; children: React.ReactNode }) {
  const selected = useOpenId() === id;
  const ref = useRef<HTMLLIElement>(null);
  const motion = useLeaveMotion(useLeaving(id));
  useEffect(() => {
    // Keeps the open article in sight when it was reached by j / k or a direct link.
    if (selected && isWide()) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <>
      <LeavingGhosts before={id} />
      <li
        ref={ref}
        data-article={id}
        aria-current={selected ? "true" : undefined}
        {...motion}
        className={`pressable-card flex flex-col rounded-xl border bg-surface ${
          selected ? "border-accent ring-1 ring-accent" : "border-line"
        } has-[[data-pending=true]]:border-accent has-[[data-pending=true]]:ring-2 has-[[data-pending=true]]:ring-accent [&:has([data-pending=true])_h2]:text-accent`}
      >
        {children}
      </li>
    </>
  );
}

/**
 * Slides a card out in `dir`, then closes it up so the cards below move into the gap, and
 * hides it; `onGone` runs then. With no `dir` (「元に戻す」) the card shows again. Returns the
 * props for the card's li.
 */
function useLeaveMotion(dir: LeaveDirection | undefined, onGone?: () => void) {
  const [phase, setPhase] = useState<"collapsing" | "gone" | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  if (!dir && phase) {
    setPhase(null);
    setHeight(null);
  }
  useEffect(() => {
    if (phase !== "collapsing") return;
    const timer = setTimeout(() => setPhase("gone"), 260);
    return () => clearTimeout(timer);
  }, [phase]);
  // Reduced motion: no slide or collapse, the card just goes. Never true on the server, where
  // nothing is leaving.
  const gone = phase === "gone" || (!!dir && reducedMotion());
  const goneRef = useRef(onGone);
  useEffect(() => {
    goneRef.current = onGone;
  });
  useEffect(() => {
    if (gone) goneRef.current?.();
  }, [gone]);
  return {
    "data-leaving": dir,
    "data-collapsing": phase === "collapsing" ? "" : undefined,
    hidden: gone,
    style: height === null ? undefined : { height },
    onAnimationEnd: (e: React.AnimationEvent<HTMLLIElement>) => {
      if (e.target !== e.currentTarget || !dir || phase) return;
      // Fixes the height the collapse runs from.
      setHeight(e.currentTarget.offsetHeight);
      setPhase("collapsing");
    },
  };
}

/**
 * Copies of cards that left a list which has since been fetched again without them (see
 * Ghost), shown where they were and removed once they have left. Put one before each card
 * (InboxItem does) and one, with `before={null}`, after the last.
 */
export function LeavingGhosts({ before }: { before: number | null }) {
  const { leaving, listed, setLeaving } = useContext(LeavingContext);
  const ghosts = [...leaving].filter(
    ([id, card]) => card.ghost && card.ghost.before === before && listed && !listed.includes(id),
  );
  return ghosts.map(([id, card]) => (
    <LeavingGhost key={id} card={card} onGone={() => setLeaving(id, null)} />
  ));
}

function LeavingGhost({ card, onGone }: { card: LeavingCard; onGone: () => void }) {
  const motion = useLeaveMotion(card.dir, onGone);
  return (
    <li
      aria-hidden="true"
      inert
      {...motion}
      className={card.ghost!.className}
      dangerouslySetInnerHTML={{ __html: card.ghost!.html }}
    />
  );
}

/**
 * The スキップ button on a list card, pulled up onto the card's last row (reading time etc.) to save height.
 * Refreshes the router itself; see the note in lib/actions.ts.
 */
export function CardSkipButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useNavPending(pending);
  const { setLeaving } = useContext(LeavingContext);
  const leftInbox = useLeftInbox();
  const toast = useToast();
  return (
    <form
      // Not a form action: React would hold the card's leaving until the transition below is done.
      onSubmit={(e) => {
        e.preventDefault();
        // The card starts leaving at once, while the action runs.
        const since = performance.now();
        const done = skipArticle(id);
        leftInbox(id, "skip", { done });
        startTransition(async () => {
          try {
            await done;
          } catch (e) {
            // Puts the card back and says so, rather than showing the error page.
            console.error(e);
            setLeaving(id, null);
            toast.fail(FAILED, { owner: id });
            return;
          }
          refreshAfterLeave(router, since);
        });
      }}
      className="-mt-6 flex justify-end self-end px-2 pb-1"
    >
      <button
        disabled={pending}
        aria-busy={pending || undefined}
        className="pressable px-2 py-1 text-xs text-muted disabled:opacity-50"
      >
        スキップ
      </button>
    </form>
  );
}
