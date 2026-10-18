"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
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

/** Tells the shell which articles the list shows, in order. */
export function InboxNavSync({ ids }: { ids: number[] }) {
  const { setIds } = useContext(InboxNavContext);
  const key = ids.join(",");
  useEffect(() => {
    setIds(key ? key.split(",").map(Number) : []);
  }, [key, setIds]);
  return null;
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
