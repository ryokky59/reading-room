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
import { markFeedSeen, markFolderSeen, skipArticle, undoLeave, unmarkSeen } from "@/lib/actions";
import { lastNavPath } from "@/lib/last-nav";
import { OPENED_COOKIE, parseOpened, serializeOpened } from "@/lib/opened";
import { track } from "@/lib/track";
import { BusyButton } from "./BusyButton";
import { Header } from "./Header";
import { InboxControls } from "./InboxControls";
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

function readOpened() {
  const match = new RegExp(`(?:^|; )${OPENED_COOKIE}=([^;]*)`).exec(document.cookie);
  return parseOpened(match?.[1]);
}

function writeOpened(ids: number[]) {
  const age = ids.length ? "" : "; max-age=0";
  document.cookie = `${OPENED_COOKIE}=${serializeOpened(ids)}; path=/; samesite=lax${age}`;
}

type Opened = {
  /** The articles opened beside the list since the shell mounted; their cards fade at once. */
  opened: ReadonlySet<number>;
  /** Stops fading a card, once its article is unread again. */
  forget: (id: number) => void;
  /**
   * Keeps a seen article in the list, faded, though it was not opened beside it: one that
   * 「元に戻す」 put back. On phones too, where opening an article does not keep it.
   */
  keep: (id: number) => void;
  /**
   * After 「すべて既読」: `rows` (a Board column's) leave; without them, the list keeps only the
   * open article.
   */
  clear: (rows?: number[]) => void;
};

const OpenedContext = createContext<Opened>({ opened: new Set(), forget: () => {}, keep: () => {}, clear: () => {} });

/** Forgets that an article was opened beside the list, for when it goes back to unread. */
export function useForgetOpened() {
  return useContext(OpenedContext).forget;
}

/**
 * Keeps the articles opened beside the list (see lib/opened.ts). A full load of the list starts
 * without them: the server ignores the cookie for it (lib/opened-request.ts) and this drops the
 * cookie before the router's next request. Beside an article, a reload keeps them. Phones have no list beside the article
 * and drop a seen card, but a row opened from the Board stays: it may be its section's last.
 */
function useOpened(openId: number | null, fromBoard: boolean): Opened {
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set(openId === null ? [] : [openId]));
  const [lastOpenId, setLastOpenId] = useState(openId);
  if (openId !== lastOpenId) {
    setLastOpenId(openId);
    if (openId !== null) setOpened(new Set(opened).add(openId));
  }
  const openIdRef = useRef(openId);
  const forget = useCallback((id: number) => {
    setOpened((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);
  const keep = useCallback((id: number) => {
    setOpened((s) => (s.has(id) ? s : new Set(s).add(id)));
    writeOpened([...readOpened().filter((other) => other !== id), id]);
  }, []);
  const clear = useCallback((rows?: number[]) => {
    const keep = (id: number) => (rows ? !rows.includes(id) : id === openIdRef.current);
    setOpened((s) => new Set([...s].filter(keep)));
    writeOpened(readOpened().filter(keep));
  }, []);
  // A layout effect: the cookie must be there before ListAfterFullLoad's effect asks for the list.
  useLayoutEffect(() => {
    openIdRef.current = openId;
    if (openId !== null && (isWide() || fromBoard)) writeOpened([...readOpened().filter((id) => id !== openId), openId]);
  }, [openId, fromBoard]);
  useLayoutEffect(() => {
    if (openIdRef.current === null) writeOpened([]);
  }, []);
  return useMemo(() => ({ opened, forget, keep, clear }), [opened, forget, keep, clear]);
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
 * the inbox as it was: an article that was seen (既読) comes back seen, as a faded card that
 * stays in the list until the next full load. Only the latest toast can be undone. With `refetched`, the list is about to be
 * fetched again without the card, so a copy of the card is kept to leave in its place.
 */
export function useLeftInbox() {
  const { setLeaving } = useContext(LeavingContext);
  const toast = useToast();
  const router = useRouter();
  const { forget, keep } = useContext(OpenedContext);
  return useCallback(
    (id: number, kind: "read" | "skip", { done = Promise.resolve(), refetched = false } = {}) => {
      const dir = kind === "read" ? "right" : "left";
      setLeaving(id, { dir, ghost: refetched ? takeGhost(id) : undefined });
      // Called outside any transition, so the card shows again at once; the refresh then
      // puts it where the list has it.
      const undo = async () => {
        setLeaving(id, null);
        let seen: boolean;
        try {
          // The restore must not reach the server before the read / skip does.
          await done.catch(() => {});
          seen = await undoLeave(id);
        } catch (e) {
          console.error(e);
          setLeaving(id, { dir });
          toast.fail(FAILED, { owner: id, undo });
          return;
        }
        // The screen it was pressed on; not a step of the view the article may have open.
        track("undo", { articleId: id, viewId: null, props: { of: kind } });
        // Before the refresh: the list query drops a seen row that the cookie does not name.
        if (seen) keep(id);
        else forget(id);
        router.refresh();
      };
      toast.show(kind === "read" ? "読了にしました" : "スキップしました", { owner: id, undo });
    },
    [setLeaving, toast, router, forget, keep],
  );
}

/** The article id open next to the list, if any. */
function useOpenId() {
  const match = /^\/articles\/(\d+)/.exec(usePathname());
  return match ? Number(match[1]) : null;
}

type BoardOrigin = {
  /** The Board last shown, with its folder tab; null until one has shown. */
  href: string | null;
  /** Whether the Board, not a feed list, was on screen when the open article was opened. */
  openedFrom: boolean;
};

const BoardOriginContext = createContext<BoardOrigin>({ href: null, openedFrom: false });

/** Whether a URL shows the Board. Reads the params of showsBoard in lib/inbox.ts. */
export function showsBoardUrl(pathname: string, params: URLSearchParams) {
  return pathname === "/" && !/^[1-9]\d{0,9}$/.test(params.get("s") ?? "") && params.get("a") !== "1";
}

/** The URL if it shows the Board, else null. */
function useBoardUrl() {
  const params = useSearchParams();
  const atBoard = showsBoardUrl(usePathname(), params);
  return atBoard ? `/${params.size ? `?${params}` : ""}` : null;
}

/**
 * Remembers the Board an article was opened from. A Board row links to `/articles/<id>?f&s`, so
 * the article's filter alone would lead back to the feed list, and only the Board has the place
 * the owner left. Held here and not in the URL: the article URL stays what a feed list links to,
 * and a reload (which forgets this) goes to that feed list.
 */
function useBoardOrigin(open: boolean): BoardOrigin {
  const board = useBoardUrl();
  const [href, setHref] = useState(board);
  const [openedFrom, setOpenedFrom] = useState(board !== null);
  if (board !== null && board !== href) setHref(board);
  if (!open && openedFrom !== (board !== null)) setOpenedFrom(board !== null);
  return useMemo(() => ({ href, openedFrom }), [href, openedFrom]);
}

/** Where leaving an article goes: its Board if it was opened from one, else `inboxHref`. */
export function useLeaveHref(inboxHref: string) {
  const { href, openedFrom } = useContext(BoardOriginContext);
  return openedFrom && href ? href : inboxHref;
}

/** 「‹ ボード」 on a feed list: back to the folder tab it came from. It closes an open article. */
export function BoardLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const { href } = useContext(BoardOriginContext);
  return (
    <Link href={href ?? "/"} className={className}>
      {children}
    </Link>
  );
}

/**
 * Holds the Board. Next.js keeps the list slot as it was when an article opens from a Board row,
 * but the pane beside an article is too narrow for columns: from `split` up it gets the feed list
 * instead, by the same route as an article loaded directly (ListAfterFullLoad). Phones hide the
 * slot and keep the Board under the article, so ← finds it where it was.
 *
 * `columns` are the row ids of each column. An open article moves only within its own column,
 * from before the feed list arrives; with no article open every row counts as listed.
 */
export function BoardPane({ columns, children }: { columns: number[][]; children: React.ReactNode }) {
  const openId = useOpenId();
  const open = openId !== null;
  const ids = open ? (columns.find((c) => c.includes(openId)) ?? []) : columns.flat();
  return (
    <>
      <InboxNavSync ids={ids} />
      {open && <ListAfterFullLoad />}
      <div className={`${open ? "split:hidden" : "board:flex"} board:h-full board:min-w-0 board:flex-col`}>{children}</div>
    </>
  );
}

/** A row of a Board column, faded once it is seen, like a list card (see useFaded). */
export function BoardRow({
  id,
  seen,
  className,
  children,
}: {
  id: number;
  seen: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const faded = useFaded(id, seen);
  return (
    <li
      data-row={id}
      data-seen={faded ? "" : undefined}
      className={`${className} ${faded ? "opacity-60" : ""} has-[[data-pending=true]]:bg-accent-soft`}
    >
      {children}
    </li>
  );
}

/**
 * Holds the list pane and the page beside it. The list is a parallel route slot, so opening
 * another article swaps only `children`: the list keeps its scroll position and filter.
 */
export function InboxShell({
  list,
  lastFetched,
  children,
}: {
  list: React.ReactNode;
  lastFetched: string | null;
  children: React.ReactNode;
}) {
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
  const openId = useOpenId();
  const open = openId !== null;
  const boardOrigin = useBoardOrigin(open);
  const openedValue = useOpened(openId, boardOrigin.openedFrom);
  usePhoneListScroll(open);
  useArticleUrlAfterListChange();
  useRefreshOnLeavingArticle(open, leaving.size > 0);
  // The Board takes the whole width; nothing goes beside it.
  const board = useBoardUrl() !== null;
  return (
    <InboxNavContext.Provider value={{ ids: shownIds, setIds: syncIds }}>
      <LeavingContext.Provider value={leavingValue}>
        <OpenedContext.Provider value={openedValue}>
        <BoardOriginContext.Provider value={boardOrigin}>
        {/* Phones: bottom centre, and hidden over an article, whose buttons sit at the bottom.
            Beside an article (`split` and up): over the bottom of the list pane. */}
        <ToastProvider
          className={`${open ? "hidden split:block" : ""} pointer-events-none fixed z-40 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] split:right-auto split:left-[calc(1rem+env(safe-area-inset-left))] split:w-[15.5rem] lg:w-[18rem]`}
        >
          <div className="split:flex split:h-dvh split:flex-col">
            <Header
              active="inbox"
              className={open ? "hidden split:block" : undefined}
              panes
              controls={<InboxControls lastFetched={lastFetched} />}
            />
            <div className="split:flex split:min-h-0 split:flex-1">
              {/* A role, not an element, so the list is not remounted when an article opens. */}
              {/* The safe-area insets (0 on PCs) keep the panes clear of a landscape iPhone's notch and corners. */}
              <div
                role={open ? "region" : "main"}
                aria-label={open ? "新着一覧" : undefined}
                className={`${open ? "hidden split:block" : ""} ${
                  board
                    ? "split:min-w-0 split:flex-1 split:overflow-y-auto split:pr-[env(safe-area-inset-right)]"
                    : "split:w-[calc(17.5rem+env(safe-area-inset-left))] lg:w-[calc(20rem+env(safe-area-inset-left))] split:shrink-0 split:overflow-y-auto split:overscroll-contain split:border-r split:border-line"
                } split:pl-[env(safe-area-inset-left)]`}
              >
                {list}
              </div>
              <div
                className={`${open ? "" : "hidden"} ${board ? "" : "split:flex"} split:min-w-0 split:flex-1 split:pr-[env(safe-area-inset-right)]`}
              >
                {children}
              </div>
            </div>
          </div>
        </ToastProvider>
        </BoardOriginContext.Provider>
        </OpenedContext.Provider>
      </LeavingContext.Provider>
    </InboxNavContext.Provider>
  );
}

/**
 * The article page marks its article as seen on the server, and the list keeps what it showed
 * until told otherwise (browser back brings it from the router's cache, too). So coming back
 * from an article refreshes it, for the unread counts. A card leaving the list has its refresh
 * coming, timed so that the card can finish leaving.
 */
function useRefreshOnLeavingArticle(open: boolean, cardLeaving: boolean) {
  const router = useRouter();
  const wasOpen = useRef(open);
  const hold = useRef(cardLeaving);
  useEffect(() => {
    hold.current = cardLeaving;
  });
  useEffect(() => {
    if (wasOpen.current && !open && !hold.current) router.refresh();
    wasOpen.current = open;
  }, [open, router]);
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
    // The browser may have moved on (back / forward) before this effect ran on a slow CPU. A
    // replace now would win over that move and bring the article back, so it is left alone.
    // Likewise a navigation started in the commit that showed this URL (j, k, a card) has not
    // changed the URL yet, but a replace now would discard it. Only the router's last navigation
    // being to this URL (or none since a full load) means nothing else is on its way.
    const last = lastNavPath();
    if (match && window.location.pathname === pathname && (last === null || last === pathname))
      router.replace(`/articles/${match[1]}${search ? `?${search}` : ""}`, { scroll: false });
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
      // As in useArticleUrlAfterListChange: skip once the browser has left this article's URL.
      if (media.matches && window.location.pathname === `/articles/${openId}`)
        router.replace(`/articles/${openId}/list${search ? `?${search}` : ""}`, { scroll: false });
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

/** Whether a card shows as seen: the server says so, or its article was opened since the list came. */
function useFaded(id: number, seen: boolean) {
  return useContext(OpenedContext).opened.has(id) || seen;
}

/**
 * A list card, highlighted while its article is open beside the list. It sinks while its link is
 * held, and its link's LinkPending outlines it until the article starts to show. After 読了 or
 * スキップ it slides out, closes up and stays hidden until the refreshed list drops it.
 */
export function InboxItem({ id, seen, children }: { id: number; seen: boolean; children: React.ReactNode }) {
  const selected = useOpenId() === id;
  const unsee = useFaded(id, seen);
  const faded = unsee && !selected;
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
        data-seen={faded ? "" : undefined}
        // The card offers 「未読に戻す」, wider than スキップ: its last row leaves more room (InboxList).
        data-unsee={unsee ? "" : undefined}
        {...motion}
        className={`group/card pressable-card flex flex-col rounded-xl border bg-surface ${
          selected ? "border-accent ring-1 ring-accent" : "border-line"
        } ${faded ? "opacity-60" : ""} has-[[data-pending=true]]:border-accent has-[[data-pending=true]]:ring-2 has-[[data-pending=true]]:ring-accent [&:has([data-pending=true])_h2]:text-accent`}
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
 * The button on a list card, pulled up onto the card's last row (reading time etc.) to save
 * height. That row has room for one button, and a card must not grow when its article opens, so
 * a seen card offers 「未読に戻す」 in place of スキップ: it is out of the unread count already,
 * and its article can still be skipped once open. The row keeps its right end clear for the
 * button (InboxList), and both buttons are flex items of the same height.
 */
export function CardActions({ id, seen }: { id: number; seen: boolean }) {
  const faded = useFaded(id, seen);
  return (
    <div className="-mt-6 flex items-center justify-end self-end px-2 pb-1">
      {faded ? <CardUnseeButton id={id} /> : <CardSkipButton id={id} />}
    </div>
  );
}

/**
 * 「未読に戻す」 on a seen card. Beside its open article it also closes the article, whose page
 * would mark it as seen again on the next refresh.
 */
function CardUnseeButton({ id }: { id: number }) {
  const router = useRouter();
  const openId = useOpenId();
  const search = useSearchParams().toString();
  const [pending, startTransition] = useTransition();
  useNavPending(pending);
  const forget = useForgetOpened();
  const toast = useToast();
  const leaveHref = useLeaveHref(`/${search ? `?${search}` : ""}`);
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        startTransition(async () => {
          try {
            await unmarkSeen([id]);
          } catch (e) {
            console.error(e);
            toast.fail(FAILED, { owner: id });
            return;
          }
          // A list card, also beside the article (whose URL says `article`).
          track("unsee", { screen: "list", articleId: id, viewId: null });
          forget(id);
          // Browser back (or forward) during the save has already moved to another page; pushing
          // now would replace it (#76). Refreshing there still shows the card as unread.
          const here = `/articles/${id}`;
          const stillOpen = window.location.pathname === here || window.location.pathname === `${here}/list`;
          if (openId === id && stillOpen) router.push(leaveHref);
          else router.refresh();
        })
      }
      className="pressable px-2 py-1 text-xs text-accent disabled:opacity-50"
    >
      未読に戻す
    </button>
  );
}

/**
 * 「すべて既読」 for a site, a folder, or (feedId null) the articles with no feed. Unconfirmed:
 * 「既読を含む」 still has the articles. In a Board column, `rows` are the column's rows, so the
 * seen rows of the other columns stay.
 */
export function MarkAllSeenButton({
  target,
  rows,
  screen,
}: {
  target: { feedId: number | null } | { folderId: number | null };
  rows?: number[];
  /** Where the button is, for the activity log: beside an article the URL says `article`. */
  screen: "board" | "list";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useNavPending(pending);
  const { clear } = useContext(OpenedContext);
  const toast = useToast();
  return (
    <BusyButton
      type="button"
      busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await ("feedId" in target ? markFeedSeen(target.feedId) : markFolderSeen(target.folderId));
          } catch (e) {
            console.error(e);
            toast.fail(FAILED);
            return;
          }
          track("seen_all", { screen, props: target });
          clear(rows);
          router.refresh();
        })
      }
      className="py-1 text-accent disabled:opacity-60"
    >
      すべて既読
    </BusyButton>
  );
}

/**
 * The スキップ button on a list card.
 * Refreshes the router itself; see the note in lib/actions.ts.
 */
function CardSkipButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useNavPending(pending);
  const { setLeaving } = useContext(LeavingContext);
  const leftInbox = useLeftInbox();
  const toast = useToast();
  return (
    <form
      // A flex item, like 「未読に戻す」: as inline content the button would sit in a taller line.
      className="flex"
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
          // Skipped without being read here, even beside an open article (whose URL says `article`).
          track("skip", { screen: "list", articleId: id, viewId: null, props: { via: "button" } });
          refreshAfterLeave(router, since);
        });
      }}
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
