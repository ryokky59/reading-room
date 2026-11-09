"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ListLink } from "./InboxShell";
import { LinkPending } from "./NavPending";

/**
 * A single line of chips that scrolls sideways on its own instead of widening the page.
 * One pill behind the chips marks the chosen one: it slides to a chip as soon as it is pressed
 * (its LinkPending says `data-pending="true"`) and stays on the `aria-current="page"` chip once
 * the new list is in. The chips themselves only turn accent (see `.chip-row` in globals.css).
 */
export function ChipRow({ children, small }: { children: React.ReactNode; small?: boolean }) {
  const row = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLLIElement>(null);
  const shown = useRef<Element | null>(null);

  const place = useCallback(() => {
    const ul = row.current;
    const p = pill.current;
    if (!ul || !p) return;
    // A hidden row (the phone list while an article is open) measures 0: place the pill afresh,
    // without a slide, once the row shows again.
    if (ul.offsetParent === null || ul.clientWidth === 0) {
      delete ul.dataset.pill;
      return;
    }
    const on = ul.querySelector<HTMLElement>('a[aria-current="page"]');
    const target = ul.querySelector('[data-pending="true"]')?.closest<HTMLElement>("a") ?? on;
    if (!target) {
      p.hidden = true;
      delete ul.dataset.pill;
      return;
    }
    p.hidden = false;
    // Put in place without sliding the first time, so a page (or a site row) does not open with a slide.
    const first = !("pill" in ul.dataset);
    if (first) p.style.transition = "none";
    p.style.left = `${target.offsetLeft}px`;
    p.style.top = `${target.offsetTop}px`;
    p.style.width = `${target.offsetWidth}px`;
    p.style.height = `${target.offsetHeight}px`;
    if (first) {
      p.getBoundingClientRect();
      p.style.transition = "";
      ul.dataset.pill = "";
    }

    // After the list changes, bring the chosen chip into the row's view (not the page's: the
    // page keeps its scroll) so the pill is not left off screen.
    if (on && on !== shown.current) {
      // A row already scrolled at mount (before hydration finished) is left where it is: moving it
      // now would pull the chip under the finger away.
      const keep = shown.current === null && ul.scrollLeft > 0;
      shown.current = on;
      if (!keep) {
        const pad = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
        const left = on.offsetLeft - pad;
        const right = on.offsetLeft + on.offsetWidth + pad;
        if (left < ul.scrollLeft) ul.scrollLeft = left;
        else if (right > ul.scrollLeft + ul.clientWidth) ul.scrollLeft = right - ul.clientWidth;
      }
    }
  }, []);

  // Every render: the server may have swapped the chips (a new list, new counts).
  useLayoutEffect(() => place());

  useEffect(() => {
    const ul = row.current;
    if (!ul) return;
    // Chip widths change with the font and the screen.
    const sizes = new ResizeObserver(place);
    const watchSizes = () => {
      sizes.disconnect();
      sizes.observe(ul);
      for (const a of ul.querySelectorAll("a")) sizes.observe(a);
    };
    watchSizes();
    // A pressed chip marks itself without this row rendering again.
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList")) watchSizes();
      place();
    });
    mutations.observe(ul, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-pending", "aria-current"],
    });
    return () => {
      mutations.disconnect();
      sizes.disconnect();
    };
  }, [place]);

  return (
    <ul
      ref={row}
      className={`chip-row relative -mx-4 flex overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] ${small ? "gap-1.5" : "gap-2"}`}
    >
      <li ref={pill} aria-hidden="true" hidden className="chip-pill" />
      {children}
    </ul>
  );
}

/** One chip of a ChipRow, with its unread count. */
export function Chip({
  query,
  label,
  count,
  on,
  small,
}: {
  query: string;
  label: string;
  count?: number;
  on: boolean;
  small?: boolean;
}) {
  return (
    <li className="shrink-0">
      <ListLink
        query={query}
        aria-current={on ? "page" : undefined}
        // The chosen chip's look is in `.chip-row` (globals.css): ChipRow's pill is its background.
        className={`pressable relative z-[1] flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface text-muted ${
          small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        {label}
        {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
        <LinkPending />
      </ListLink>
    </li>
  );
}
