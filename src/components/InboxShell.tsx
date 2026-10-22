"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { skipArticle } from "@/lib/actions";
import { Header } from "./Header";

// PCs (Tailwind `lg` and up) read with the list, the article and the chat side by side.
// Phones keep separate list and article screens.
const WIDE = "(min-width: 1024px)";

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

/** The order of the list pane, for opening the next / previous article. */
export function useInboxIds() {
  return useContext(InboxNavContext).ids;
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
  const open = useOpenId() !== null;
  usePhoneListScroll(open);
  useArticleUrlAfterListChange();
  return (
    <InboxNavContext.Provider value={{ ids, setIds }}>
      <div className="lg:flex lg:h-dvh lg:flex-col">
        <Header active="inbox" className={open ? "hidden lg:block" : undefined} panes />
        <div className="lg:flex lg:min-h-0 lg:flex-1">
          {/* A role, not an element, so the list is not remounted when an article opens. */}
          <div
            role={open ? "region" : "main"}
            aria-label={open ? "新着一覧" : undefined}
            className={`${open ? "hidden lg:block" : ""} lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-line`}
          >
            {list}
          </div>
          <div className={`${open ? "" : "hidden"} lg:flex lg:min-w-0 lg:flex-1`}>{children}</div>
        </div>
      </div>
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
  useEffect(() => {
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
    <div className="hidden px-4 pt-4 lg:block" aria-busy="true">
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

/** A list card, highlighted while its article is open beside the list. */
export function InboxItem({ id, children }: { id: number; children: React.ReactNode }) {
  const selected = useOpenId() === id;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Keeps the open article in sight when it was reached by j / k or a direct link.
    if (selected && isWide()) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <li
      ref={ref}
      aria-current={selected ? "true" : undefined}
      className={`flex flex-col rounded-xl border bg-surface ${
        selected ? "border-accent ring-1 ring-accent" : "border-line"
      }`}
    >
      {children}
    </li>
  );
}

/**
 * The スキップ button on a list card, pulled up onto the card's last row (reading time etc.) to save height.
 * Refreshes the router itself; see the note in lib/actions.ts.
 */
export function CardSkipButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <form
      action={async () => {
        await skipArticle(id);
        router.refresh();
      }}
      className="-mt-6 flex justify-end self-end px-2 pb-1"
    >
      <button className="px-2 py-1 text-xs text-muted">スキップ</button>
    </form>
  );
}
